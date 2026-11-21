import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, CountPill } from "@/ui";
import { fadedStyle } from "@/ui/fade-style";

/**
 * 全站「清單列」模組（業主 2026-11-21：所有「清單」模式一律照中心頁清單的樣子，改一次全站一起變）：
 * - `CompactRow`＝一列：左側縮圖／圖示、第一行標題（單行「…」）、第二行 `meta`（日期膠囊＋文字）、右側按鈕區；列高很窄、上下行距緊密。
 * - `RowButtons`＝右側按鈕區：「加入我的清單」「分享」靠得很近，分享鈕貼齊最右邊。
 * - `MetaLine`＝第二行（日期膠囊＋說明文字）。
 * - `ListSection`＝區塊標題列（區塊名稱＋教材數量），內容是 0 就淡化。
 * 用在：中心頁「清單」、系列頁「清單」（`CenterListCard`）、教材卡頁「清單」（`MaterialRow`、`FullVersionList`）。要改清單的樣子只改這個檔案。
 */
export function CompactRow({ leading, title, meta, actions, onPress, highlight, faded, label }: { leading?: ReactNode; title: string; meta?: ReactNode; actions?: ReactNode; onPress?: () => void; highlight?: boolean; faded?: boolean; label?: string }) {
  const { c } = useTheme();
  return (
    <View style={faded ? fadedStyle : undefined}>
      <Pressable
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityLabel={label}
        disabled={!onPress}
        onPress={onPress}
        style={({ pressed }) => [styles.row, { borderBottomColor: c.border }, highlight && { backgroundColor: c.accentSoft, borderRadius: radius.md }, pressed && { opacity: 0.7 }]}
      >
        {leading}
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="headline" numberOfLines={1} style={styles.tight}>
            {title}
          </AppText>
          {meta}
        </View>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </Pressable>
    </View>
  );
}

/** 第二行：日期膠囊＋文字（沒有日期也沒有文字就不顯示）。 */
export function MetaLine({ date, text }: { date?: string; text?: string }) {
  const { c } = useTheme();
  if (!date && !text) return null;
  return (
    <AppText variant="callout" tone="muted" numberOfLines={1} style={styles.tight}>
      {date ? <Text style={[styles.chip, { backgroundColor: c.accentSoft, color: c.accentText }]}>{` ${date} `}</Text> : null}
      {date && text ? "  " : ""}
      {text}
    </AppText>
  );
}

/** 右側按鈕區：按鈕之間靠得很近，整組貼齊列的最右邊。 */
export function RowButtons({ children }: { children: ReactNode }) {
  return <View style={styles.buttons}>{children}</View>;
}

/** 區塊標題列：區塊名稱（最多 2 行）＋教材數量；數量是 0 就淡化。 */
export function ListSection({ title, count }: { title: string; count: number }) {
  const { c } = useTheme();
  return (
    <View style={[styles.section, { borderBottomColor: c.border }, count === 0 && fadedStyle]}>
      <AppText variant="headline" style={{ flex: 1 }} numberOfLines={2}>
        {title}
      </AppText>
      <CountPill count={count} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 3, paddingLeft: space.sm, paddingRight: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  actions: { marginRight: -space.xs },
  buttons: { flexDirection: "row", alignItems: "center", gap: 0 },
  tight: { lineHeight: 20 },
  chip: { fontSize: 12, lineHeight: 18, fontWeight: "700", borderRadius: 9, overflow: "hidden" },
  section: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm, paddingHorizontal: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
});
