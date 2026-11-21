import { router } from "expo-router";
import type { ReactNode } from "react";
import { Image, StyleSheet, View } from "react-native";
import { CompactRow, MetaLine } from "@/features/courses/compact-row";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText } from "@/ui";
import { itemHref } from "./links";
import type { ListKind } from "./store";

export type ListItem = { id: string; kind: ListKind; ref: string; ref2: string; note: string; title: string; subtitle: string; coverUrl: string | null; missing: boolean };
const KIND_LABEL: Record<ListKind, string> = { course: "課程", lesson: "教材", series: "系列", center: "中心" };

/**
 * 清單項目一列：用全站清單列模組 `CompactRow`（縮圖、單行標題、第二行類型＋說明，列高緊密，沒有外框），
 * 備註顯示在下面一行；內容已下架時淡化並標「已下架」（仍留在清單裡，點了不會壞）。我的清單頁與公開清單頁共用。
 */
export function ListItemRow({ item, children }: { item: ListItem; children?: ReactNode }) {
  const { c } = useTheme();
  const text = `${KIND_LABEL[item.kind]}${item.subtitle ? `・${item.subtitle}` : ""}${item.missing ? "・已下架" : ""}`;
  return (
    <View>
      <CompactRow
        label={item.title}
        faded={item.missing}
        onPress={item.missing ? undefined : () => router.push(itemHref(item) as never)}
        leading={
          <View style={[styles.thumb, { backgroundColor: c.surfaceMuted }]}>{item.coverUrl ? <Image source={{ uri: item.coverUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}</View>
        }
        title={item.title}
        meta={
          <>
            <MetaLine text={text} />
            {item.note ? (
              <AppText variant="callout" numberOfLines={1} style={{ color: c.accentText, lineHeight: 18 }}>
                📝 {item.note}
              </AppText>
            ) : null}
          </>
        }
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 48, height: 30, borderRadius: radius.sm, overflow: "hidden", marginVertical: space.xs / 2 },
});
