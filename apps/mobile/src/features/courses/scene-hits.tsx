import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { api, resolveUrl } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText } from "@/ui";
import { EdmLightbox } from "./edm-viewer";
import { flashText } from "@/ui/flash-notice";

type Hit = { blockId: string; courseId: string; courseTitle: string; blockTitle: string; count: number; scene: string; locked?: boolean; lockLines?: string[]; /** 符合的照片（有權限才有）：點了直接全螢幕看圖。 */ photos?: { id: string; url: string }[] };

/**
 * 相簿照片的「場景」搜尋（業主 2026-11-24）：AI 看照片認出的場景、行為、物品，搜尋時分類標籤＝「場景」。
 * 停止打字 0.4 秒才送出；伺服器只回你有權限看的課程（獎銜、瀏覽範圍鎖住的不會出現）。
 */
export function useSceneSearch(q: string): { hits: Hit[]; loading: boolean } {
  const text = q.trim();
  const [res, setRes] = useState<{ q: string; hits: Hit[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (text.replace(/\s+/g, "").length < 2) {
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      api<{ hits: Hit[] }>("GET", `/search/scenes?q=${encodeURIComponent(text)}`)
        .then((r) => id === seq.current && setRes({ q: text, hits: r.hits }))
        .catch(() => id === seq.current && setRes({ q: text, hits: [] }))
        .finally(() => id === seq.current && setLoading(false));
    }, 400);
    return () => clearTimeout(t);
  }, [text]);
  return { hits: res?.q === text ? res.hits : [], loading };
}

/** 點一列＝直接全螢幕看符合的照片（共用 EdmLightbox，可左右翻、下載、分享）；沒有照片資料才進課程頁相簿。沒權限＝顯示原因。 */
const gotoAlbum = (h: Hit) => router.push(`/course/${h.courseId}?album=${encodeURIComponent(h.blockId)}` as never);

/**
 * 搜尋結果裡的「場景」區：每列＝一個有符合照片的區塊（課程 › 區塊、幾張、符合的標籤）。
 * big＝至尊模式版：大字、粗框、整列好按（重新配置，不照抄超派的小標籤列）。
 */
export function SceneHits({ q, big }: { q: string; big?: boolean }) {
  const { c } = useTheme();
  const { hits } = useSceneSearch(q);
  const [view, setView] = useState<Hit | null>(null);
  if (!hits.length) return null;
  const open = (h: Hit) => (h.locked ? flashText((h.lockLines ?? ["目前無法使用"]).join("，")) : h.photos?.length ? setView(h) : gotoAlbum(h));
  const lightbox = view?.photos?.length ? <EdmLightbox uri={resolveUrl(view.photos[0]!.url)} title={`${view.courseTitle} ${view.blockTitle}`} items={view.photos.map((x) => ({ uri: x.url, title: `${view.courseTitle} ${view.blockTitle}`, id: x.id }))} onClose={() => setView(null)} /> : null;
  if (big) {
    return (
      <View style={{ gap: space.sm }}>
        {lightbox}
        <AppText variant="headline" style={{ fontWeight: "800" }}>{`場景：找到 ${hits.length} 個相簿`}</AppText>
        {hits.map((h) => (
          <Pressable key={h.blockId} accessibilityRole="button" accessibilityLabel={`場景，${h.courseTitle} ${h.blockTitle}，${h.count} 張照片`} onPress={() => open(h)} style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 4, borderColor: c.accent, backgroundColor: c.surface }}>
            <Ionicons name={h.locked ? "lock-closed" : "images"} size={30} color={h.locked ? c.textMuted : c.accentText} />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="headline" numberOfLines={2} style={{ fontWeight: "800" }}>{`${h.courseTitle} › ${h.blockTitle}`}</AppText>
              <AppText variant="callout" tone="muted">{`${h.count} 張・${h.locked ? (h.lockLines ?? [])[0] ?? "沒有權限" : h.scene}`}</AppText>
            </View>
            <Ionicons name="chevron-forward" size={26} color={c.accentText} />
          </Pressable>
        ))}
      </View>
    );
  }
  return (
    <View style={{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.md, overflow: "hidden" }}>
      {lightbox}
      {hits.map((h) => (
        <Pressable key={h.blockId} accessibilityRole="button" accessibilityLabel={`場景 ${h.courseTitle} ${h.blockTitle}，${h.count} 張`} onPress={() => open(h)} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 52, paddingHorizontal: space.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border }}>
          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: c.accentSoft }}>
            <AppText variant="caption" style={{ color: c.accentText, fontWeight: "700" }}>場景</AppText>
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="body" numberOfLines={1}>{`${h.courseTitle} › ${h.blockTitle}`}</AppText>
            <AppText variant="caption" tone="muted" numberOfLines={1}>{`${h.count} 張・${h.locked ? (h.lockLines ?? [])[0] ?? "沒有權限" : h.scene}`}</AppText>
          </View>
          {h.locked ? <Ionicons name="lock-closed" size={16} color={c.textMuted} /> : null}
          <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}
