import { router, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText } from "@/ui";
import type { SemanticHit } from "@/features/courses/use-semantic";

/**
 * 「意思相近的其他項目」（業主 2026-11-25）：語意搜尋命中的非課程卡資料——單一教材、區塊、系列卡、中心卡、課程介紹、EDM、相片。
 * 每筆前面有膠囊標籤＝它屬於哪一類（標籤文字由伺服器 search-sources.ts 決定）；點一下進對應頁面。超派、至尊共用，big＝至尊大字。
 */
export function SemanticExtras({ items, big }: { items: SemanticHit[]; big?: boolean }) {
  const { c } = useTheme();
  if (!items.length) return null;
  return (
    <View style={{ gap: 2 }}>
      <AppText variant={big ? "headline" : "callout"} style={{ fontWeight: "800" }}>意思相近的其他項目</AppText>
      {items.map((h) => (
        <Pressable key={h.id} accessibilityRole="link" accessibilityLabel={`${h.tag}：${h.title}`} onPress={() => router.push(h.link as Href)} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: big ? 72 : 52, paddingVertical: space.sm, borderBottomWidth: 1, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}>
          <TagPill label={h.tag} big={big} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant={big ? "headline" : "body"} numberOfLines={2} style={{ fontWeight: "700" }}>{h.title}</AppText>
            {h.sub ? <AppText variant="caption" tone="muted" numberOfLines={1}>{h.sub}</AppText> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

/** 資料類別膠囊標籤（搜尋結果共用）。 */
export function TagPill({ label, big }: { label: string; big?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ borderRadius: radius.pill, paddingHorizontal: big ? 14 : 10, paddingVertical: big ? 5 : 3, backgroundColor: c.accentSoft, alignSelf: "flex-start" }}>
      <AppText variant={big ? "callout" : "caption"} numberOfLines={1} style={{ color: c.accentText, fontWeight: "800" }}>{label}</AppText>
    </View>
  );
}
