import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText } from "./text";
import { Icon } from "./icon";
import { fadedStyle } from "./fade-style";

/**
 * 上拉選單的「可點進去的列」（業主 2026-11-18 永久指示：所有上拉選單統一，改一次全站一起變）：
 * 左邊縮圖（`SheetThumb`）→ 標題（最多 2 行，可加副標題）→ 右邊依序是：數量膠囊（`count`，**只顯示數字**）、自訂標籤（`right`）、
 * **放大的向右箭頭**（`chevron`，預設有；25 像素）。列與列之間用細線分隔、整列最小觸控高度一致。
 * 要改列高、箭頭大小、數量膠囊樣式只改這個檔案；新增任何上拉選單的點選列一律用它，不可再自己畫「›」或「有N個…」。
 */
export function SheetRow({ leading, title, subtitle, count, right, onPress, faded, disabled, chevron = true, accessibilityLabel }: { leading?: ReactNode; title: string; subtitle?: string; count?: number; right?: ReactNode; onPress?: () => void; faded?: boolean; disabled?: boolean; chevron?: boolean; accessibilityLabel?: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} disabled={disabled} onPress={onPress} style={[styles.row, { borderTopColor: c.border }, faded ? fadedStyle : null, disabled ? { opacity: 0.4 } : null]}>
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body" style={{ fontWeight: "700" }} numberOfLines={2}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="callout" tone="muted" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {count !== undefined ? <CountPill count={count} /> : null}
      {right}
      {chevron ? <Icon name="chevron-forward" size={25} color={c.textMuted} /> : null}
    </Pressable>
  );
}

/** 數量膠囊：只顯示數字。 */
export function CountPill({ count }: { count: number }) {
  const { c } = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: c.surfaceMuted, borderColor: c.border }]} accessible={false}>
      <AppText variant="callout" style={{ color: c.text, fontWeight: "800" }}>
        {count}
      </AppText>
    </View>
  );
}

/** 列左邊的縮圖框（16:9 小圖，白底，透明背景的圖才不會發黑）。 */
export function SheetThumb({ children }: { children: ReactNode }) {
  return <View style={styles.thumb}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouch + 12, borderTopWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
  // 數量膠囊：小圓形徽章（業主 2026-11-20：原本在列裡被拉成又高又胖的橢圓），垂直置中、不隨列高拉長。
  pill: { alignSelf: "center", minWidth: 28, height: 28, paddingHorizontal: 8, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  thumb: { width: 64, height: 36, borderRadius: radius.sm, backgroundColor: "#fff", overflow: "hidden" },
});
