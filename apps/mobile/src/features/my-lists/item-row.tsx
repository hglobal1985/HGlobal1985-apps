import { router } from "expo-router";
import type { ReactNode } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText } from "@/ui";
import { itemHref } from "./links";
import type { ListKind } from "./store";

export type ListItem = { id: string; kind: ListKind; ref: string; ref2: string; note: string; title: string; subtitle: string; coverUrl: string | null; missing: boolean; block?: boolean };
const KIND_LABEL: Record<ListKind, string> = { course: "課程", lesson: "教材", series: "系列", center: "中心" };

/** 清單項目一列：封面、標題、類型、備註；內容已下架時淡化並標「已下架」（仍留在清單裡，點了不會壞）。我的清單頁與公開清單頁共用。 */
export function ListItemRow({ item, children }: { item: ListItem; children?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={[styles.wrap, { borderTopColor: c.border }]}>
      <Pressable accessibilityRole="link" accessibilityLabel={item.title} disabled={item.missing} onPress={() => router.push(itemHref(item) as never)} style={[styles.row, item.missing && { opacity: 0.55 }]}>
        <View style={[styles.thumb, { backgroundColor: "#fff", borderColor: c.border }]}>{item.coverUrl ? <Image source={{ uri: item.coverUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}</View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="body" style={{ fontWeight: "700" }} numberOfLines={2}>
            {item.title}
          </AppText>
          <AppText variant="callout" tone="muted" numberOfLines={1}>
            {KIND_LABEL[item.kind]}
            {item.subtitle ? `・${item.subtitle}` : ""}
          </AppText>
        </View>
        {item.missing ? (
          <View style={[styles.tag, { backgroundColor: c.surfaceMuted, borderColor: c.border }]}>
            <AppText variant="caption" tone="muted" style={{ fontWeight: "800" }}>
              已下架
            </AppText>
          </View>
        ) : null}
      </Pressable>
      {item.note ? (
        <AppText variant="callout" style={{ color: c.accentText, paddingLeft: 72 }}>
          📝 {item.note}
        </AppText>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: space.sm, gap: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56 },
  thumb: { width: 64, height: 36, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
});
