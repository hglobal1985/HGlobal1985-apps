import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText } from "@/ui";
import { fadedStyle } from "@/ui/fade-style";

/**
 * 全站「清單列」模組（杜杜龍 2026-11-21：所有「清單」模式一律照中心頁清單的樣子，改一次全站一起變）：
 * - `CompactRow`＝一列：左側縮圖／圖示、第一行標題（單行「…」）、第二行 `meta`（日期膠囊＋文字）、右側按鈕區；列高很窄、上下行距緊密。
 * - `RowButtons`＝右側按鈕區：「加入我的清單」「分享」靠得很近，分享鈕貼齊最右邊。
 * - `MetaLine`＝第二行（日期膠囊＋說明文字）。
 * - `ListSection`＝區塊標題列（區塊名稱＋教材數量），內容是 0 就淡化。
 * 用在：中心頁「清單」、系列頁「清單」（`CenterListCard`）、教材卡頁「清單」（`MaterialRow`、`FullVersionList`）。要改清單的樣子只改這個檔案。
 */
export function CompactRow({ leading, title, titleLines = 1, meta, actions, onPress, highlight, faded, label }: { /** 標題最多幾行（預設 1；教材列用 2，太長自動加高，杜杜龍 2026-11-23）。 */ titleLines?: number; leading?: ReactNode; title: string; meta?: ReactNode; actions?: ReactNode; onPress?: () => void; highlight?: boolean; faded?: boolean; label?: string }) {
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
          <AppText variant="headline" numberOfLines={titleLines} style={styles.tight}>
            {title}
          </AppText>
          {meta}
        </View>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </Pressable>
    </View>
  );
}

/**
 * 第二行：日期膠囊＋文字（沒有日期也沒有文字就不顯示）。
 * 用橫排 View（不是同一段文字裡塞小字膠囊）：混用不同字級的行內文字會讓整行基線上下偏移，造成標題上方的行距比下方大（杜杜龍 2026-11-21 回報）。
 */
export function MetaLine({ date, text }: { date?: string; text?: string }) {
  const { c } = useTheme();
  if (!date && !text) return null;
  return (
    <View style={styles.meta}>
      {date ? (
        <View style={[styles.chip, { backgroundColor: c.accentSoft }]}>
          <Text style={[styles.chipText, { color: c.accentText }]} numberOfLines={1}>
            {date}
          </Text>
        </View>
      ) : null}
      {text ? (
        <AppText variant="callout" tone="muted" numberOfLines={1} style={[styles.metaText, { flexShrink: 1 }]}>
          {text}
        </AppText>
      ) : null}
    </View>
  );
}

/** 右側按鈕區：按鈕之間靠得很近，整組貼齊列的最右邊。 */
export function RowButtons({ children }: { children: ReactNode }) {
  return <View style={styles.buttons}>{children}</View>;
}

/** 清單卡的外框樣式：列與列之間不留空（Card 預設有 gap，會讓第一列上方多出一截，杜杜龍 2026-11-21 回報）。 */
export const LIST_CARD = { paddingVertical: 0, paddingHorizontal: space.sm, gap: 0 } as const;

/**
 * 區塊（或課程）標題列（杜杜龍 2026-11-21 選定方案 C「淡綠標題列」）：整條淡綠底、貼齊卡片左右與上緣；左邊是教材數量的白底圓圈（綠字），
 * 接著區塊／課程名稱（綠色粗體、最多 2 行），右邊放 `actions`（加入我的清單＋分享，和下方每列的鈕一樣、沒有外框）。數量是 0 就淡化。
 */
export function ListSection({ title, count, actions }: { title: string; count: number; actions?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: c.accentSoft }, count === 0 && fadedStyle]}>
      <View style={[styles.num, { backgroundColor: c.surface }]}>
        <Text style={[styles.numText, { color: c.accentText }]} {...({ dataSet: { noScale: "" } } as object)}>
          {count}
        </Text>
      </View>
      <AppText variant="headline" style={{ flex: 1, fontWeight: "800", color: c.accentText }} numberOfLines={2}>
        {title}
      </AppText>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 4, paddingLeft: space.sm, paddingRight: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  actions: { marginRight: -space.xs },
  buttons: { flexDirection: "row", alignItems: "center", gap: 0 },
  tight: { lineHeight: 20 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, height: 18 },
  metaText: { lineHeight: 18 },
  chip: { height: 17, paddingHorizontal: 5, borderRadius: 9, justifyContent: "center" },
  chipText: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  section: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: -space.sm, paddingVertical: 6, paddingLeft: 16, paddingRight: space.sm, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  numText: { fontSize: 13, fontWeight: "800" },
});
