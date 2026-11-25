import Ionicons from "@expo/vector-icons/Ionicons";
import { createElement, useState } from "react";
import { Image, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { api, resolveUrl, type CoverMediaItem, type CoverMediaKind, type CoverScope } from "@/api/client";
import { confirmAsk } from "@/features/confirm";
import { replaceAlbumPhoto } from "@/features/uploads/album-replace";
import { useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { useFeature } from "@/lib/app-mode";
import { useThumb } from "@/lib/thumb";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, EmptyState } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import { EdmLightbox, lightboxItem } from "./edm-viewer";

const NO_SCALE = Platform.OS === "web" ? ({ dataSet: { noScale: "" } } as object) : {};
const GAP = 6;
const COLS = 3;

/**
 * 相簿（業主 2026-11-21）：中心頁第一個分頁「相簿」，也用在系列、課程封面的照片管理。
 * 與封面輪播是同一份資料（cover_media）：這裡新增的照片與短影音，會直接出現在封面輪播；管理者可上傳、整理順序、刪除。
 * 點照片開全螢幕看圖（可左右翻整本相簿）；點影片開播放視窗。
 */
export function CoverAlbum({ kind, ownerKey, title, items, canEdit, onChanged, scope, emptyHint }: { kind: CoverMediaKind; ownerKey: string; title: string; items: CoverMediaItem[]; canEdit: boolean; onChanged: () => void; /** 中心的儲存區（cover＝封面編輯、edm＝EDM 分頁）；系列、課程不用給。 */ scope?: CoverScope; emptyHint?: string }) {
  const { c } = useTheme();
  const thumb = useThumb();
  // canEdit＝看的人的權限（兩種模式一樣傳）；要不要顯示排序／刪除等編輯小鈕由模式設定檔決定（至尊模式 adminEdit＝false）。
  // 「圖片資訊」驚嘆號只看權限，兩種模式都有（業主 2026-11-24 回報至尊模式少了驚嘆號）。
  const adminEdit = useFeature("adminEdit");
  const editUi = canEdit && adminEdit;
  const { config } = useUiConfig();
  const { member } = useSession();
  const infoOk = !!member?.courseRights?.all; // 超級管理者：任何相簿照片（含區塊照片、場景搜尋）都有「圖片資訊」驚嘆號
  const [w, setW] = useState(0);
  const [view, setView] = useState<string | null>(null); // 看哪張圖（照片編號）
  const [play, setPlay] = useState<CoverMediaItem | null>(null);
  const images = items.filter((x) => x.kind === "image");
  const tile = w ? Math.floor((w - GAP * (COLS - 1)) / COLS) : 0;
  const move = async (id: string, d: number) => {
    const ids = items.map((x) => x.id);
    const i = ids.indexOf(id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    try {
      await api("POST", "/admin/cover-media/order", { kind, key: ownerKey, ids, ...(scope ? { scope } : {}) });
      onChanged();
    } catch (e) {
      flashText((e as Error).message);
    }
  };
  const remove = async (x: CoverMediaItem) => {
    if (!(await confirmAsk(x.kind === "video" ? "刪除影片" : "刪除照片", "確定刪除？刪除後無法復原。", "刪除"))) return;
    try {
      await api("DELETE", `/admin/cover-media/${x.id}`);
      onChanged();
      flashText("已刪除");
    } catch (e) {
      flashText((e as Error).message);
    }
  };
  // 綁定課程的 EDM 不能刪，只能更換照片（業主 2026-11-23）。
  const replace = (x: CoverMediaItem) => replaceAlbumPhoto(x.id, { maxSide: config.app.centerMaxSide, quality: config.app.centerQuality / 100 }, onChanged);
  return (
    <View style={{ gap: space.md }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {!items.length ? <EmptyState icon="images-outline" title={scope === "edm" ? "還沒有 EDM" : "還沒有照片"} body={editUi ? emptyHint ?? (scope === "edm" ? "按右下角「新增教材 › 上傳EDM」新增。" : undefined) : undefined} /> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
        {items.map((x, i) => (
          <View key={x.id} style={{ width: tile || "33%", height: tile ? (scope === "edm" ? Math.round((tile * 4) / 3) : tile) : 100, borderRadius: radius.sm, overflow: "hidden", backgroundColor: c.surfaceMuted }}>
            <Pressable accessibilityRole="button" accessibilityLabel={x.kind === "video" ? "播放影片" : "放大照片"} onPress={() => (x.kind === "video" ? setPlay(x) : setView(x.id))} style={StyleSheet.absoluteFill}>
              {x.kind === "image" || x.posterUrl ? <Image source={{ uri: thumb(resolveUrl(x.kind === "video" ? x.posterUrl! : x.url), 480) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: "#222" }]} />}
              {x.kind === "video" ? (
                <View style={styles.playBadge}>
                  <Ionicons name="play" size={22} color="#fff" />
                </View>
              ) : null}
            </Pressable>
            {scope === "edm" && x.eventDate ? (
              <View style={{ position: "absolute", left: 4, top: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.6)" }} pointerEvents="none">
                <AppText variant="caption" style={{ color: "#fff", fontSize: 11, lineHeight: 14, fontWeight: "700" }} {...NO_SCALE}>
                  {x.eventDate.slice(5).replace("-", "/")}
                </AppText>
              </View>
            ) : null}
            {x.courseId ? (
              <View style={styles.courseTag} pointerEvents="none">
                <Ionicons name="link" size={11} color="#fff" {...NO_SCALE} />
                <AppText variant="caption" numberOfLines={1} style={{ color: "#fff", fontSize: 11, lineHeight: 14, flexShrink: 1 }} {...NO_SCALE}>
                  {x.courseTitle || "課程"}
                </AppText>
              </View>
            ) : null}
            {editUi ? (
              <View style={styles.tools} pointerEvents="box-none">
                {<Pressable accessibilityRole="button" hitSlop={6} accessibilityLabel="往前移" disabled={i === 0} onPress={() => move(x.id, -1)} style={[styles.tbtn, i === 0 && { opacity: 0.35 }]}>
                  <Ionicons name="chevron-back" size={16} color="#fff" {...NO_SCALE} />
                </Pressable>}
                {x.courseId ? (
                  <Pressable accessibilityRole="button" hitSlop={6} accessibilityLabel="更換照片" onPress={() => replace(x)} style={[styles.tbtn, { backgroundColor: "rgba(12,96,60,0.95)" }]}>
                    <Ionicons name="swap-horizontal" size={16} color="#fff" {...NO_SCALE} />
                  </Pressable>
                ) : (
                  <Pressable accessibilityRole="button" hitSlop={6} accessibilityLabel="刪除" onPress={() => remove(x)} style={[styles.tbtn, { backgroundColor: "rgba(179,38,30,0.9)" }]}>
                    <Ionicons name="trash" size={15} color="#fff" {...NO_SCALE} />
                  </Pressable>
                )}
                {<Pressable accessibilityRole="button" hitSlop={6} accessibilityLabel="往後移" disabled={i === items.length - 1} onPress={() => move(x.id, 1)} style={[styles.tbtn, i === items.length - 1 && { opacity: 0.35 }]}>
                  <Ionicons name="chevron-forward" size={16} color="#fff" {...NO_SCALE} />
                </Pressable>}
              </View>
            ) : null}
          </View>
        ))}
      </View>
      {view !== null && images.length ? <EdmLightbox uri={images[0]!.url} title={title} showInfo={(canEdit && scope === "edm") || infoOk} items={images.map((x) => lightboxItem(x, title))} index={Math.max(0, images.findIndex((x) => x.id === view))} onClose={() => setView(null)} /> : null}
      {play ? <VideoModal item={play} onClose={() => setPlay(null)} /> : null}
    </View>
  );
}

/** 影片播放視窗（網頁版；預設有聲音，因為是使用者主動點開的）。App 版先顯示預覽圖。 */
function VideoModal({ item, onClose }: { item: CoverMediaItem; onClose: () => void }) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="關閉" />
        {Platform.OS === "web" ? createElement("video", { src: resolveUrl(item.url), poster: item.posterUrl ? resolveUrl(item.posterUrl) : undefined, controls: true, autoPlay: true, playsInline: true, style: { maxWidth: "100%", maxHeight: "100%", background: "#000" } }) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="關閉" onPress={onClose} style={styles.close}>
          <Ionicons name="close" size={26} color="#fff" {...({ uiOnly: true } as object)} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  courseTag: { position: "absolute", left: 4, right: 4, top: 4, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 8, backgroundColor: "rgba(12,96,60,0.88)" },
  playBadge: { position: "absolute", right: 6, bottom: 6, width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  tools: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 4, paddingVertical: 3, backgroundColor: "rgba(0,0,0,0.35)" },
  tbtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  close: { position: "absolute", top: 16, right: 16, width: 50, height: 50, borderRadius: 25, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
});
