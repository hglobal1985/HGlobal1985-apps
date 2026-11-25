import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolveUrl } from "@/api/client";
import { downloadImages, shareImages } from "@/lib/share";
import { useThumb } from "@/lib/thumb";
import { space } from "@/theme/tokens";
import { AppText, ShareIcon } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import type { LightboxItem } from "./edm-viewer";

const UI_ONLY = { uiOnly: true } as object;
const UI_ONLY_TEXT = { dataSet: { uiOnly: "" } } as object;
const NO_SELECT = Platform.OS === "web" ? ({ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" } as object) : null;

/**
 * 全螢幕看圖的「檢視全部」（業主 2026-11-25）：一格一張縮圖。
 * 點一下＝回到單張看那一張；長按一張＝進入複選（之後點一下就是勾選／取消），可全選、下載、分享給其他 App。
 */
export function LightboxGrid({ list, current, onPick, onClose }: { list: LightboxItem[]; current: number; onPick: (i: number) => void; onClose: () => void }) {
  const thumb = useThumb();
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [sel, setSel] = useState<Set<number> | null>(null); // null＝一般模式；Set＝複選模式
  const [busy, setBusy] = useState(false);
  const gap = 4;
  const cols = Math.max(3, Math.floor(win.width / 140));
  const cell = Math.floor((win.width - insets.left - insets.right - gap * (cols + 1)) / cols);
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
    <View style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }]} pointerEvents="auto">
      <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <View style={styles.label}>
          <AppText variant="callout" {...UI_ONLY_TEXT} numberOfLines={1} style={{ color: "#fff", fontWeight: "800" }}>
            {sel ? `已選 ${picked.length} 張` : `全部 ${list.length} 張・長按可複選`}
          </AppText>
        </View>
        <View style={{ flex: 1 }} />
        {sel ? (
          <>
            {btn(picked.length === list.length ? "取消全選" : "全選", () => setSel(picked.length === list.length ? new Set() : new Set(list.map((_, i) => i))), <Ionicons name={picked.length === list.length ? "checkmark-done-circle" : "checkmark-done-outline"} size={26} color="#fff" {...UI_ONLY} />)}
            {btn("下載", () => void run(() => downloadImages(urls(), name), "下載失敗，請稍後再試"), <Ionicons name="download-outline" size={24} color="#fff" {...UI_ONLY} />, !picked.length || busy)}
            {btn("分享", () => void run(() => shareImages(name, urls()), "分享失敗，請稍後再試"), <ShareIcon size={24} color="#fff" uiOnly />, !picked.length || busy)}
            {btn("取消複選", () => setSel(null), <Ionicons name="close" size={26} color="#fff" {...UI_ONLY} />)}
          </>
        ) : (
          btn("回到單張檢視", onClose, <Ionicons name="close" size={26} color="#fff" {...UI_ONLY} />)
        )}
      </View>
      <ScrollView contentContainerStyle={{ padding: gap, paddingLeft: gap + insets.left, paddingBottom: insets.bottom + 24, flexDirection: "row", flexWrap: "wrap", gap }}>
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
  label: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.18)", maxWidth: 200 },
  mark: { position: "absolute", right: 6, top: 6, width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.3)" },
});
