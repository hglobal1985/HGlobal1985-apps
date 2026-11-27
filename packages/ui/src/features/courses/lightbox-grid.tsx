import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type ScrollViewInstance } from "react-native";
import { useInsets } from "@/lib/inline-page";
import { resolveUrl } from "@/api/client";
import { downloadImages, shareImages } from "@/lib/share";
import { trackUsage } from "@/lib/usage";
import { useThumb } from "@/lib/thumb";
import { space } from "@/theme/tokens";
import { AppText, ShareIcon } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import type { LightboxItem } from "./lightbox";

const UI_ONLY = { uiOnly: true } as object;
const UI_ONLY_TEXT = { dataSet: { uiOnly: "" } } as object;
const NO_SELECT = Platform.OS === "web" ? ({ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" } as object) : null;

/**
 * 全螢幕看圖的「檢視全部」（杜杜龍 2026-11-25）：一格一張縮圖。
 * 點一下＝回到單張看那一張；長按一張＝進入複選（之後點一下就是勾選／取消），可全選、下載、分享給其他 App。
 */
export function LightboxGrid({ list, current, onPick, onClose, heading, extra, actions, embedded = false, parent, onMove }: { /** 標題上方的小字（區塊相簿的子資料夾：上層區塊名稱）。 */ parent?: string; /** 複選時多一顆「移到資料夾」鈕（有管理權限的區塊相簿用）；回傳選取的照片編號。 */ onMove?: (ids: string[]) => void; /** 標題列右邊的圖示按鈕（例如排序）。 */ actions?: ReactNode; /** 嵌在相簿資料夾檢視裡（不蓋滿畫面、不自帶黑底）：左邊是返回鈕（杜杜龍 2026-11-25）。 */ embedded?: boolean; list: LightboxItem[]; current: number; onPick: (i: number) => void; onClose: () => void; /** 相簿資料夾名稱（從「相簿」進來時顯示在標籤上）。 */ heading?: string; /** 格子上方的額外內容（例如有權限者的「上傳照片」按鈕）。 */ extra?: ReactNode }) {
  const thumb = useThumb();
  const win = useWindowDimensions();
  const insets = useInsets();
  const [sel, setSel] = useState<Set<number> | null>(null); // null＝一般模式；Set＝複選模式
  const [busy, setBusy] = useState(false);
  const gap = 4;
  const [boxW, setBoxW] = useState(0); // 嵌在相簿裡時，格子寬度看容器寬度（側邊欄會讓它變窄）
  const areaW = embedded && boxW ? boxW : win.width - insets.left - insets.right;
  const cols = Math.max(3, Math.floor(areaW / 140));
  const cell = Math.floor((areaW - gap * (cols + 1)) / cols);
  // 從單張看圖按 ✕ 回到縮圖清單：自動捲到剛剛那張照片的位置，不跳回最上面（杜杜龍 2026-11-25）。
  const scroller = useRef<ScrollViewInstance | null>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || current < 0 || !list.length || cell <= 0 || (embedded && !boxW)) return;
    focused.current = true;
    const y = Math.max(0, Math.floor(current / cols) * (cell + gap) - Math.round(cell * 0.6));
    const t = setTimeout(() => scroller.current?.scrollTo({ y, animated: false }), 30);
    return () => clearTimeout(t);
  }, [current, list.length, cols, cell, boxW]); // eslint-disable-line react-hooks/exhaustive-deps
  const picked = sel ? [...sel].sort((a, b) => a - b) : [];
  const toggle = (i: number) =>
    setSel((s) => {
      const n = new Set(s ?? []);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const urls = () => picked.map((i) => list[i]!.uri);
  const name = list[0]?.title || "照片";
  const run = async (fn: () => Promise<unknown>, fail: string) => {
    if (!picked.length || busy) return;
    setBusy(true);
    try {
      const r = await fn();
      if (r === "copied") flashText("已複製連結");
    } catch {
      flashText(fail);
    } finally {
      setBusy(false);
    }
  };
  const btn = (label: string, onPress: () => void, icon: React.ReactNode, disabled?: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} style={[styles.tool, { opacity: disabled ? 0.45 : 1 }]}>
      {icon}
    </Pressable>
  );
  return (
    <View style={embedded ? { flex: 1, minHeight: 0 } : [StyleSheet.absoluteFill, { backgroundColor: "#000" }]} pointerEvents="auto" onLayout={embedded ? (e) => setBoxW(Math.floor(e.nativeEvent.layout.width)) : undefined}>
      <View style={{ paddingTop: embedded ? 8 : insets.top + 16, paddingHorizontal: embedded ? 0 : 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: space.xs }}>
        {/* 資料夾名稱（杜杜龍 2026-11-25）：沒有張數統計、太長自動變兩行；右邊的排序按鈕固定顯示，不會被名稱擠掉。 */}
        <View style={[styles.label, embedded && heading && !sel ? { flex: 1, minWidth: 0, maxWidth: undefined } : null]}>
          {parent && !sel ? <AppText {...UI_ONLY_TEXT} numberOfLines={1} style={{ color: "#9a9aa0", fontSize: 12 }}>{parent}</AppText> : null}
          <AppText variant="callout" {...UI_ONLY_TEXT} numberOfLines={embedded && heading && !sel ? 2 : 1} style={{ color: "#fff", fontWeight: "800" }}>
            {sel ? `已選 ${picked.length} 張` : heading ? heading : `全部 ${list.length} 張・長按可複選`}
          </AppText>
        </View>
        {embedded && heading && !sel ? null : <View style={{ flex: 1 }} />}
        {sel ? (
          <>
            {btn(picked.length === list.length ? "取消全選" : "全選", () => setSel(picked.length === list.length ? new Set() : new Set(list.map((_, i) => i))), <Ionicons name={picked.length === list.length ? "checkmark-done-circle" : "checkmark-done-outline"} size={26} color="#fff" {...UI_ONLY} />)}
            {onMove ? btn("移到資料夾", () => onMove(picked.map((i) => list[i]!.id ?? "").filter(Boolean)), <Ionicons name="folder-open-outline" size={24} color="#fff" {...UI_ONLY} />, !picked.length) : null}
            {btn("下載", () => (trackUsage("album_download", "複選"), void run(() => downloadImages(urls(), name), "下載失敗，請稍後再試")), <Ionicons name="download-outline" size={24} color="#fff" {...UI_ONLY} />, !picked.length || busy)}
            {btn("分享", () => (trackUsage("album_share", "複選"), void run(() => shareImages(name, urls()), "分享失敗，請稍後再試")), <ShareIcon size={24} color="#fff" uiOnly />, !picked.length || busy)}
            {btn("取消複選", () => setSel(null), <Ionicons name="close" size={26} color="#fff" {...UI_ONLY} />)}
          </>
        ) : embedded ? (
          actions ? <View style={{ flexShrink: 0 }}>{actions}</View> : null
        ) : (
          btn("回到單張檢視", onClose, <Ionicons name="close" size={26} color="#fff" {...UI_ONLY} />)
        )}
      </View>
      {extra && !sel ? <View style={{ paddingHorizontal: embedded ? 0 : 16, paddingBottom: 8 }}>{extra}</View> : null}
      <ScrollView ref={scroller} contentContainerStyle={{ padding: gap, paddingLeft: embedded ? gap : gap + insets.left, paddingBottom: insets.bottom + 24, flexDirection: "row", flexWrap: "wrap", gap }}>
        {list.map((it, i) => {
          const on = !!sel?.has(i);
          return (
            <Pressable
              key={`${it.id ?? it.uri}-${i}`}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`第 ${i + 1} 張${on ? "，已選取" : ""}`}
              onPress={() => (sel ? toggle(i) : onPick(i))}
              onLongPress={() => (sel ? toggle(i) : setSel(new Set([i])))}
              delayLongPress={350}
              style={[{ width: cell, height: cell, backgroundColor: "#222", overflow: "hidden" }, NO_SELECT]}
            >
              <Image source={{ uri: thumb(resolveUrl(it.uri), 320) }} style={{ width: "100%", height: "100%", opacity: on ? 0.55 : 1 }} resizeMode="cover" accessibilityIgnoresInvertColors />
              {i === current && !sel ? <View style={[StyleSheet.absoluteFill, { borderWidth: 3, borderColor: "#fff" }]} pointerEvents="none" /> : null}
              {sel ? (
                <View style={[styles.mark, on && { backgroundColor: "#2e7d32", borderColor: "#2e7d32" }]} pointerEvents="none">
                  {on ? <Ionicons name="checkmark" size={18} color="#fff" {...UI_ONLY} /> : null}
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  tool: { width: 50, height: 50, borderRadius: 25, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  label: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.18)", maxWidth: 240 },
  mark: { position: "absolute", right: 6, top: 6, width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.3)" },
});
