import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { useApi } from "@/state/session";
import { flashText } from "@/ui/flash-notice";
import { space } from "@/theme/tokens";

/** 圖片資訊（GET /admin/cover-media/:id/info；只有能管理這個相簿的人讀得到）。 */
export type MediaInfo = {
  id: string;
  kind: "image" | "video";
  scope: "cover" | "edm";
  width: number;
  height: number;
  durationSec: number;
  bytes: number;
  position: number;
  ownerKind: "center" | "series" | "course";
  ownerKey: string;
  uploader: string;
  uploaderSub: string;
  uploadedAt: string;
  courseId: string | null;
  courseTitle: string | null;
  ocrStatus: string;
  ocrModel: string;
  ocrAt: string | null;
  eventDate: string | null;
  ocrText: string;
  /** 套入「AI 文字辨識」欄位格式後的內容；fields 為 null＝還沒整理好（顯示清理過的原文）。 */
  structured: { fields: [string, string][] | null; other: string; stale: boolean };
  file: { name?: string; type?: string; bytes?: number; width?: number; height?: number; lastModified?: string };
  exif: Record<string, unknown>;
};

const NO_PULL = Platform.OS === "web" ? ({ dataSet: { noPullRefresh: "" } } as object) : {};
const SELECTABLE = Platform.OS === "web" ? ({ userSelect: "text", cursor: "text" } as object) : {};

const size = (b?: number) => (!b ? "—" : b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
/** 2026-11-24T08:00:00Z 或 2026:11:24 16:00:00 → 台灣時間顯示。 */
const when = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(/^\d{4}-\d\d-\d\d \d/.test(v) ? v.replace(" ", "T") + "Z" : v);
  if (Number.isNaN(d.getTime())) return String(v);
  const t = new Date(d.getTime() + 8 * 3600 * 1000).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 16)}`;
};
/** 複製用：照欄位格式排好的純文字（沒整理好就是辨識原文）。 */
const formatted = (i: MediaInfo) =>
  i.structured.fields ? [...i.structured.fields.filter(([, v]) => v).map(([k, v]) => `${k}：${v}`), ...(i.structured.other ? [`其他內容：${i.structured.other}`] : [])].join("\n") : i.ocrText;
const OCR_STATUS: Record<string, string> = { "": "尚未辨識（稍後會自動辨識）", working: "辨識中…", done: "已辨識", failed: "辨識失敗" };
const OWNER: Record<string, string> = { center: "中心", series: "系列", course: "課程" };

// EXIF 欄位的中文名稱；沒列在這裡的欄位最後以原名顯示。
const EXIF_LABEL: [string, string][] = [
  ["Make", "相機廠牌"], ["Model", "相機／手機型號"], ["LensModel", "鏡頭"], ["Software", "軟體"],
  ["DateTimeOriginal", "拍攝時間"], ["CreateDate", "建立時間"], ["ModifyDate", "修改時間"],
  ["ExposureTime", "快門（秒）"], ["FNumber", "光圈 f/"], ["ISO", "ISO"], ["FocalLength", "焦距（mm）"], ["FocalLengthIn35mmFormat", "等效 35mm 焦距"],
  ["ExposureProgram", "曝光程式"], ["ExposureMode", "曝光模式"], ["MeteringMode", "測光模式"], ["Flash", "閃光燈"], ["WhiteBalance", "白平衡"],
  ["Orientation", "方向"], ["ExifImageWidth", "原始寬度"], ["ExifImageHeight", "原始高度"], ["ColorSpace", "色彩空間"],
  ["latitude", "緯度"], ["longitude", "經度"], ["GPSAltitude", "海拔（公尺）"],
  ["Artist", "作者"], ["Copyright", "版權"], ["ImageDescription", "圖片說明"],
];
const text = (v: unknown) => (Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "是" : "否") : typeof v === "number" ? String(Math.round(v * 10000) / 10000) : String(v));

/**
 * 圖片資訊面板（業主 2026-11-24）：半透明黑底視窗，三大類——EXIF 詳細資訊、行動大學站內資訊、辨識後的圖片文字（可選取、可複製）。
 * 在全螢幕看圖（EdmLightbox）右上角的驚嘆號按鈕開關；視窗右上角也有 X。
 */
export function EdmInfoPanel({ id, top = 140, onClose }: { id: string; top?: number; onClose: () => void }) {
  const r = useApi<MediaInfo>(`/admin/cover-media/${id}/info`);
  const info = r.data;
  const [showRaw, setShowRaw] = useState(false);
  const copy = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      flashText("已複製文字");
    } catch {
      flashText("請長按文字選取後複製");
    }
  };
  const row = (k: string, v: string, key = k) => (
    <View key={key} style={styles.row}>
      <Text style={styles.k}>{k}</Text>
      <Text selectable style={[styles.v, SELECTABLE]}>{v || "—"}</Text>
    </View>
  );
  const exif = info?.exif ?? {};
  const known = new Set(EXIF_LABEL.map(([k]) => k));
  const exifRows = [
    ...EXIF_LABEL.filter(([k]) => exif[k] != null).map(([k, label]) => row(label, /Date|Time/.test(k) && typeof exif[k] === "string" ? when(exif[k] as string) : text(exif[k]), k)),
    ...Object.keys(exif).filter((k) => !known.has(k)).map((k) => row(k, text(exif[k]), `x-${k}`)),
  ];
  const f = info?.file ?? {};
  const gps = exif.latitude != null && exif.longitude != null ? `https://www.google.com/maps/search/?api=1&query=${exif.latitude},${exif.longitude}` : null;
  return (
    <View style={[styles.panel, { top }]} {...NO_PULL}>
      <View style={styles.head}>
        <Text style={styles.title}>圖片資訊</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="關閉圖片資訊" onPress={onClose} hitSlop={8} style={styles.x}>
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.md, gap: space.lg }} showsVerticalScrollIndicator>
        {!info ? <Text style={styles.v}>{r.error ? `讀取失敗：${r.error}` : "讀取中…"}</Text> : null}
        {info ? (
          <>
            <View style={styles.sec}>
              <Text style={styles.h}>① 辨識後的圖片文字</Text>
              {info.kind === "video" ? <Text style={styles.v}>影片沒有文字辨識。</Text> : (
                <>
                  <Text style={styles.sub}>{`狀態：${OCR_STATUS[info.ocrStatus] ?? info.ocrStatus}`}{info.eventDate ? `　活動日期：${info.eventDate}` : ""}</Text>
                  {info.ocrText ? (
                    <>
                      {info.structured.fields ? (
                        <View style={{ gap: 10 }}>
                          {info.structured.fields.filter(([, v]) => v).map(([k, v]) => (
                            <View key={k} style={{ gap: 2 }}>
                              <Text style={styles.fk}>{k}</Text>
                              <Text selectable style={[styles.body, SELECTABLE]}>{v}</Text>
                            </View>
                          ))}
                          {info.structured.other ? (
                            <View style={{ gap: 2 }}>
                              <Text style={styles.fk}>其他內容</Text>
                              <Text selectable style={[styles.body, SELECTABLE]}>{info.structured.other}</Text>
                            </View>
                          ) : null}
                          {info.structured.stale ? <Text style={styles.sub}>（欄位格式剛更新過，稍後會自動重新整理）</Text> : null}
                        </View>
                      ) : (
                        <>
                          <Text style={styles.sub}>{info.structured.stale ? "還沒套入欄位格式（AI 整理中，稍後再開會看到）；先顯示辨識原文：" : "這張無法套入欄位格式，顯示辨識原文："}</Text>
                          <Text selectable style={[styles.body, SELECTABLE]}>{info.ocrText}</Text>
                        </>
                      )}
                      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                        <Pressable accessibilityRole="button" onPress={() => copy(formatted(info))} style={styles.btn}>
                          <Ionicons name="copy-outline" size={18} color="#fff" />
                          <Text style={styles.btnText}>複製全部文字</Text>
                        </Pressable>
                        {info.structured.fields ? (
                          <Pressable accessibilityRole="button" onPress={() => setShowRaw((v) => !v)} style={styles.btn}>
                            <Text style={styles.btnText}>{showRaw ? "收起辨識原文" : "看辨識原文"}</Text>
                          </Pressable>
                        ) : null}
                      </View>
                      {showRaw && info.structured.fields ? <Text selectable style={[styles.sub, SELECTABLE]}>{info.ocrText}</Text> : null}
                    </>
                  ) : <Text style={styles.v}>{info.ocrStatus === "done" ? "沒有辨識出文字。" : "目前還沒有辨識出的文字。"}</Text>}
                </>
              )}
            </View>
            <View style={styles.sec}>
              <Text style={styles.h}>② 行動大學站內資訊</Text>
              {row("上傳者", info.uploader || "（未記錄）")}
              {row("上傳時間", when(info.uploadedAt))}
              {row("所屬", `${OWNER[info.ownerKind] ?? info.ownerKind}：${info.ownerKey || "—"}`)}
              {row("放在", info.scope === "edm" ? "中心 EDM 分頁" : "封面輪播照片")}
              {row("連結課程", info.courseId ? `${info.courseTitle || "課程"}（${info.courseId}）` : "沒有連結課程")}
              {row("排序位置", `第 ${info.position + 1} 位`)}
              {row("類型", info.kind === "video" ? `影片（${info.durationSec} 秒）` : "圖片")}
              {row("站內尺寸", info.width && info.height ? `${info.width} × ${info.height} px` : "—")}
              {row("站內檔案大小", size(info.bytes))}
              {row("上傳的原始檔", f.name ? f.name : "（舊資料，沒有記錄）")}
              {f.name ? row("原始檔大小", `${size(f.bytes)}　${f.width && f.height ? `${f.width} × ${f.height} px` : ""}　${f.type ?? ""}`) : null}
              {f.lastModified ? row("原始檔修改時間", when(f.lastModified)) : null}
              {info.ocrModel ? row("辨識模型", info.ocrModel) : null}
              {info.ocrAt ? row("辨識時間", when(info.ocrAt)) : null}
              {row("圖片編號", info.id)}
            </View>
            <View style={styles.sec}>
              <Text style={styles.h}>③ EXIF 詳細資訊</Text>
              {exifRows.length ? exifRows : <Text style={styles.v}>沒有 EXIF（舊照片、截圖、LINE／社群軟體傳來的圖通常沒有；站內存放的圖已壓縮，EXIF 只在上傳時讀取）。</Text>}
              {gps ? (
                <Pressable accessibilityRole="link" onPress={() => (typeof window !== "undefined" ? window.open(gps, "_blank") : undefined)} style={styles.btn}>
                  <Ionicons name="location" size={18} color="#fff" />
                  <Text style={styles.btnText}>在地圖開啟拍攝位置</Text>
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { position: "absolute", left: 12, right: 12, top: 140, bottom: 16, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.82)", overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 16, paddingRight: 6, paddingTop: 6, minHeight: 52 },
  title: { color: "#fff", fontSize: 18, fontWeight: "800" },
  x: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.15)" },
  sec: { gap: 8 },
  h: { color: "#ffd54f", fontSize: 16, fontWeight: "800" },
  fk: { color: "#9fd8ff", fontSize: 13, fontWeight: "800" },
  sub: { color: "#ddd", fontSize: 14 },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  k: { width: 96, color: "#bbb", fontSize: 14, lineHeight: 20 },
  v: { flex: 1, color: "#fff", fontSize: 14, lineHeight: 20 },
  body: { color: "#fff", fontSize: 16, lineHeight: 24 },
  btn: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.18)" },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
