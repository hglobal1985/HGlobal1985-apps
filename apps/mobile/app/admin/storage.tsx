import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api } from "@/api/client";
import { useUiConfig } from "@/state/ui-config";
import { Button, Icon, NoticeBox } from "@/ui";
import { centerTitle } from "@/features/format";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Card, EmptyState, ErrorView, LoadingView, Screen, Section } from "@/ui";

type Kind = "image" | "doc" | "audio" | "other";
type FileSettings = { importMaxMb: number; ticketSec: number; dailyDownloads: number; dailyDownloadMb: number };
type Storage = { totalBytes: number; objectCount: number; byType: Record<Kind, number>; byCenter: ({ center: string; total: number } & Record<Kind, number>)[]; fileSettings: FileSettings };
const KINDS: { key: Kind; label: string; color: string }[] = [
  { key: "image", label: "圖片（封面、EDM、照片）", color: "#2E7D5B" },
  { key: "doc", label: "文件檔案（PDF、簡報…）", color: "#E0A91A" },
  { key: "audio", label: "音檔", color: "#3B6FB6" },
  { key: "other", label: "其他／沒有歸屬", color: "#9A9A9A" },
];

export const sizeText = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
const pct = (n: number, t: number) => (t ? `${Math.round((n / t) * 1000) / 10}%` : "0%");

/** 一條分段長條：每段依佔比著色。 */
function StackBar({ parts, total }: { parts: { color: string; value: number }[]; total: number }) {
  const { c } = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: c.surfaceMuted }]} accessibilityRole="image">
      {parts.filter((p) => p.value > 0).map((p, i) => (
        <View key={i} style={{ flex: p.value / (total || 1), backgroundColor: p.color }} />
      ))}
    </View>
  );
}

/**
 * 設定 > 儲存空間管理（超級管理員，業主 2026-11-18）：整個網站雲端儲存已使用的容量、
 * 各類型檔案的佔比，以及各中心（含寰宇總部）各自佔用多少、裡面各類型各多少。大小是雲端的實際大小。
 */
/** 一個「減／數字／加」的調整列。 */
export function Stepper({ label, hint, value, min, max, step, unit, onChange }: { label: string; hint: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  const { c } = useTheme();
  return (
    <View style={styles.legend}>
      <View style={{ flex: 1 }}>
        <AppText variant="body">{label}</AppText>
        <AppText variant="caption" tone="muted">
          {hint}
        </AppText>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}減少`} disabled={value <= min} onPress={() => onChange(Math.max(min, value - step))} style={[styles.step, { borderColor: c.border, opacity: value <= min ? 0.35 : 1 }]}>
        <Icon name="remove" size={22} color={c.text} />
      </Pressable>
      <AppText variant="headline" style={{ minWidth: 76, textAlign: "center" }}>
        {value}
        {unit}
      </AppText>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}增加`} disabled={value >= max} onPress={() => onChange(Math.min(max, value + step))} style={[styles.step, { borderColor: c.border, opacity: value >= max ? 0.35 : 1 }]}>
        <Icon name="add" size={22} color={c.text} />
      </Pressable>
    </View>
  );
}

export default function StorageScreen() {
  const { c } = useTheme();
  const { config, reload: reloadConfig } = useUiConfig();
  const [lim, setLim] = useState({ fileMaxMb: config.app.fileMaxMb, imageMaxSide: config.app.imageMaxSide, imageQuality: config.app.imageQuality, centerMaxSide: config.app.centerMaxSide, centerQuality: config.app.centerQuality, edmMaxSide: config.app.edmMaxSide, edmQuality: config.app.edmQuality });
  useEffect(() => setLim({ fileMaxMb: config.app.fileMaxMb, imageMaxSide: config.app.imageMaxSide, imageQuality: config.app.imageQuality, centerMaxSide: config.app.centerMaxSide, centerQuality: config.app.centerQuality, edmMaxSide: config.app.edmMaxSide, edmQuality: config.app.edmQuality }), [config.app.fileMaxMb, config.app.imageMaxSide, config.app.imageQuality, config.app.centerMaxSide, config.app.centerQuality, config.app.edmMaxSide, config.app.edmQuality]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const dirty = lim.fileMaxMb !== config.app.fileMaxMb || lim.imageMaxSide !== config.app.imageMaxSide || lim.imageQuality !== config.app.imageQuality || lim.centerMaxSide !== config.app.centerMaxSide || lim.centerQuality !== config.app.centerQuality || lim.edmMaxSide !== config.app.edmMaxSide || lim.edmQuality !== config.app.edmQuality;
  const saveLim = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api("PUT", "/admin/ui-config", { app: { ...config.app, ...lim } });
      reloadConfig();
      setMsg({ tone: "success", text: "已儲存，之後的上傳照新設定。" });
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };
  const { member } = useSession();
  const [fs, setFs] = useState<FileSettings | null>(null);
  const [fsSaving, setFsSaving] = useState(false);
  const [fsMsg, setFsMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const isSuper = !!member?.titles.includes("超級管理員");
  const { data, error, loading, reload } = useApi<Storage>(isSuper ? "/admin/storage" : null);
  useEffect(() => {
    if (data) setFs(data.fileSettings);
  }, [data]);
  const saveFs = async () => {
    if (!fs) return;
    setFsSaving(true);
    setFsMsg(null);
    try {
      await api("PUT", "/admin/files/settings", fs);
      setFsMsg({ tone: "success", text: "已儲存。" });
      reload();
    } catch (e) {
      setFsMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setFsSaving(false);
    }
  };
  if (!isSuper) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="只有超級管理員可以查看" /></Screen>;
  return (
    <Screen header={false}>
      <Section title="上傳設定與圖片壓縮">
        <Card>
          <Stepper label="手機／電腦上傳的單檔上限" hint="從這支裝置選檔案上傳時，超過就不能上傳，並提示改貼雲端連結（最多 95MB）" value={lim.fileMaxMb} min={1} max={95} step={5} unit="MB" onChange={(v) => setLim((x) => ({ ...x, fileMaxMb: v }))} />
          <NoticeBox tone="info" text="所有上傳到雲端的圖片（封面、EDM、教材圖片、雲端硬碟匯入、匯入工作…全站）都會先壓縮才存，不保留原圖；使用者下載到的就是壓縮後的版本。已在上限內的圖片不會重複壓縮。" />
          <AppText variant="callout" style={{ fontWeight: "800", color: c.accentText }}>
            ① 中心封面照片（中心首頁圖）
          </AppText>
          <Stepper label="長邊像素" hint="中心封面要特別清楚，建議比一般高（預設 2048）" value={lim.centerMaxSide} min={800} max={4096} step={128} unit="px" onChange={(v) => setLim((x) => ({ ...x, centerMaxSide: v }))} />
          <Stepper label="畫質" hint="數字越大畫質越好、檔案越大（預設 95）" value={lim.centerQuality} min={70} max={100} step={1} unit="%" onChange={(v) => setLim((x) => ({ ...x, centerQuality: v }))} />
          <AppText variant="callout" style={{ fontWeight: "800", color: c.accentText }}>
            ② 一般（課程、系列、區塊封面與上傳的圖片）
          </AppText>
          <Stepper label="長邊像素" hint="上傳的圖片長邊縮到這個像素以內（預設 1024）" value={lim.imageMaxSide} min={400} max={4096} step={128} unit="px" onChange={(v) => setLim((x) => ({ ...x, imageMaxSide: v }))} />
          <Stepper label="畫質" hint="數字越大畫質越好、檔案越大（預設 88）" value={lim.imageQuality} min={50} max={100} step={2} unit="%" onChange={(v) => setLim((x) => ({ ...x, imageQuality: v }))} />
          <AppText variant="callout" style={{ fontWeight: "800", color: c.accentText }}>
            ③ EDM 海報（課程、系列的直式海報原圖）
          </AppText>
          <Stepper label="長邊像素" hint="海報上有小字與 QR code，建議維持高一點（預設 2048）" value={lim.edmMaxSide} min={800} max={4096} step={128} unit="px" onChange={(v) => setLim((x) => ({ ...x, edmMaxSide: v }))} />
          <Stepper label="畫質" hint="數字越大畫質越好、檔案越大（預設 90）" value={lim.edmQuality} min={70} max={100} step={1} unit="%" onChange={(v) => setLim((x) => ({ ...x, edmQuality: v }))} />
          {msg ? <NoticeBox tone={msg.tone} text={msg.text} /> : null}
          <Button label="儲存上傳設定" icon="save-outline" loading={saving} disabled={!dirty || saving} onPress={saveLim} fullWidth />
        </Card>
      </Section>
      <Section title="教材檔案：從 Google 雲端硬碟匯入與下載">
        <Card>
          {fs ? (
            <>
              <Stepper label="雲端硬碟匯入的單檔上限" hint="管理員從自己的 Google 雲端硬碟匯入教材時，單檔最大多少（最多 1GB）" value={fs.importMaxMb} min={1} max={1024} step={50} unit="MB" onChange={(v) => setFs({ ...fs, importMaxMb: v })} />
              <Stepper label="下載連結有效時間" hint="學員按下載後，連結幾秒內有效（只能用一次，轉傳給別人無效）" value={fs.ticketSec} min={30} max={600} step={30} unit="秒" onChange={(v) => setFs({ ...fs, ticketSec: v })} />
              <Stepper label="每人每日下載次數" hint="24 小時內最多下載幾個檔案，防止被大量搜刮（0＝不限，管理員不受限）" value={fs.dailyDownloads} min={0} max={1000} step={10} unit="次" onChange={(v) => setFs({ ...fs, dailyDownloads: v })} />
              <Stepper label="每人每日下載流量" hint="24 小時內最多下載多少（0＝不限）" value={Math.round(fs.dailyDownloadMb / 1024)} min={0} max={1000} step={1} unit="GB" onChange={(v) => setFs({ ...fs, dailyDownloadMb: v * 1024 })} />
              {fsMsg ? <NoticeBox tone={fsMsg.tone} text={fsMsg.text} /> : null}
              <Button label="儲存教材檔案設定" icon="save-outline" loading={fsSaving} disabled={fsSaving || JSON.stringify(fs) === JSON.stringify(data?.fileSettings)} onPress={saveFs} fullWidth />
            </>
          ) : (
            <LoadingView />
          )}
        </Card>
      </Section>
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingView /> : null}
      {data ? (
        <>
          <Card>
            <AppText variant="caption" tone="muted">
              已使用的儲存空間
            </AppText>
            <AppText variant="title" style={{ fontWeight: "900" }}>
              {sizeText(data.totalBytes)}
            </AppText>
            <AppText variant="caption" tone="muted">
              共 {data.objectCount} 個檔案
            </AppText>
            <StackBar total={data.totalBytes} parts={KINDS.map((k) => ({ color: k.color, value: data.byType[k.key] }))} />
            {KINDS.map((k) => (
              <View key={k.key} style={styles.legend}>
                <View style={[styles.dot, { backgroundColor: k.color }]} />
                <AppText variant="callout" style={{ flex: 1 }}>
                  {k.label}
                </AppText>
                <AppText variant="callout" style={{ fontWeight: "700" }}>
                  {sizeText(data.byType[k.key])}・{pct(data.byType[k.key], data.totalBytes)}
                </AppText>
              </View>
            ))}
          </Card>
          <Section title="各中心使用量">
            {data.byCenter.length ? (
              data.byCenter.map((r) => (
                <Card key={r.center}>
                  <View style={styles.legend}>
                    <AppText variant="headline" style={{ flex: 1 }}>
                      {r.center.startsWith("（") || r.center === "寰宇總部" ? r.center : centerTitle(r.center)}
                    </AppText>
                    <AppText variant="headline" style={{ fontWeight: "900" }}>
                      {sizeText(r.total)}
                    </AppText>
                  </View>
                  <AppText variant="caption" tone="muted">
                    佔全部 {pct(r.total, data.totalBytes)}
                  </AppText>
                  <StackBar total={r.total} parts={KINDS.map((k) => ({ color: k.color, value: r[k.key] }))} />
                  <View style={styles.chips}>
                    {KINDS.filter((k) => r[k.key] > 0).map((k) => (
                      <View key={k.key} style={[styles.chip, { borderColor: c.border }]}>
                        <View style={[styles.dot, { backgroundColor: k.color }]} />
                        <AppText variant="caption">
                          {k.label.split("（")[0]} {sizeText(r[k.key])}（{pct(r[k.key], r.total)}）
                        </AppText>
                      </View>
                    ))}
                  </View>
                </Card>
              ))
            ) : (
              <EmptyState icon="cloud-outline" title="還沒有任何檔案" />
            )}
          </Section>
          <AppText variant="caption" tone="muted">
            歸屬依檔案所屬的課程主辦中心計算；系列、品牌 logo 算在寰宇總部；沒有被任何資料使用的檔案列在「沒有歸屬」。
          </AppText>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", height: 14, borderRadius: radius.pill, overflow: "hidden", marginVertical: space.xs },
  legend: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  step: { width: 40, height: 40, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
});
