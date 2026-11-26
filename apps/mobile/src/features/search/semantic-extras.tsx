import { router, type Href } from "expo-router";
import { useState } from "react";
import { Image, Pressable, View } from "react-native";
import { resolveUrl } from "@/api/client";
import { markFromSearch } from "@/lib/search-memory";
import { useThumb } from "@/lib/thumb";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { UI_SCALE } from "@/theme/ui-scale";
import { AppText, ThumbFallback, ThumbLock } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import { EdmLightbox } from "@/features/courses/edm-viewer";
import type { SemanticHit } from "@/features/courses/use-semantic";

/**
 * 「意思相近的其他項目」（杜杜龍 2026-11-25）：語意搜尋命中的非教材卡資料——單一教材、區塊、系列卡、中心卡、課程介紹、EDM、相片。
 * 每列：左邊縮圖；右邊第一行標題、第二行開頭是小的膠囊標籤（＝它屬於哪一類）再接說明。
 * 點下去直接看內容：單一教材＝直接播放、區塊＝直接開區塊、系列／中心／課程＝該頁、EDM／相片＝直接放大看圖（不跳頁）。超派、至尊共用，big＝至尊大字。
 */
export function SemanticExtras({ items, big }: { items: SemanticHit[]; big?: boolean }) {
  const { c } = useTheme();
  const thumb = useThumb();
  const [view, setView] = useState<SemanticHit | null>(null);
  if (!items.length) return null;
  const w = Math.round((big ? 88 : 64) * (big ? UI_SCALE : 1));
  const h = Math.round((w * 4) / 3);
  return (
    <View style={{ gap: 2 }}>
      <AppText variant={big ? "headline" : "callout"} style={{ fontWeight: "800" }}>意思相近的其他項目</AppText>
      {items.map((x) => (
        <Pressable
          key={x.id}
          accessibilityRole="link"
          accessibilityLabel={`${x.tag}：${x.title}`}
          onPress={() => (x.locked && flashText((x.lockLines ?? ["目前無法使用"]).join("，")), x.locked && x.kind !== "lesson" && x.kind !== "section" && x.kind !== "intro" ? undefined : x.image ? setView(x) : (markFromSearch(), router.push(x.link as Href)))}
          style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={{ width: w, height: h, borderRadius: radius.md, overflow: "hidden", backgroundColor: c.surfaceMuted }}>
            {x.thumb ? <Image source={{ uri: thumb(resolveUrl(x.thumb), w * 2) }} style={{ width: w, height: h }} resizeMode="cover" /> : <ThumbFallback />}
            {x.locked ? <ThumbLock size={Math.round(w * 0.4)} /> : null}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <AppText variant={big ? "headline" : "body"} numberOfLines={2} style={{ fontWeight: "700" }}>{x.title}</AppText>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <TagPill label={x.tag} />
              {x.locked || x.sub ? <AppText variant="caption" tone="muted" numberOfLines={x.locked ? 2 : 1} style={{ flex: 1 }}>{x.locked ? (x.lockLines ?? ["沒有權限"])[0] : x.sub}</AppText> : null}
            </View>
          </View>
        </Pressable>
      ))}
      {view?.image ? <EdmLightbox uri={resolveUrl(view.image)} title={view.title} items={[{ uri: view.image, title: view.title, id: view.id.slice(view.id.indexOf(":") + 1) }]} onClose={() => setView(null)} /> : null}
    </View>
  );
}

/** 依「教材卡的顯示順序」把其他項目分成：排在教材卡清單上方／下方（設定頁可調，杜杜龍 2026-11-25）。 */
export function splitExtras(items: SemanticHit[], coursePrio: number): { above: SemanticHit[]; below: SemanticHit[] } {
  return { above: items.filter((h) => (h.prio ?? 0) < coursePrio), below: items.filter((h) => (h.prio ?? 0) >= coursePrio) };
}

/** 資料類別膠囊標籤（搜尋結果共用；預設小尺寸，big＝大字）。 */
export function TagPill({ label, big }: { label: string; big?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ borderRadius: radius.pill, paddingHorizontal: big ? 14 : 8, paddingVertical: big ? 5 : 1, backgroundColor: c.accentSoft, alignSelf: "flex-start" }}>
      <AppText variant={big ? "callout" : "caption"} numberOfLines={1} style={{ color: c.accentText, fontWeight: "800", ...(big ? null : { fontSize: 12, lineHeight: 16 }) }}>{label}</AppText>
    </View>
  );
}
