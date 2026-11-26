import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { UI_SCALE } from "@/theme/ui-scale";
import { Icon, type IconName } from "./icon";
import { NowPlayingIcon } from "./now-playing-icon";
import { AppText } from "./text";

export function ListRow({
  icon,
  leading,
  note,
  title,
  subtitle,
  right,
  onPress,
  unread,
  highlight,
  dense,
  compact,
  playing,
  playingLesson,
  titleLines,
  dateChip,
}: {
  icon?: IconName;
  /** 自訂的前置圖示（取代 icon），例如章節清單的主講人學士帽。 */
  leading?: ReactNode;
  /** 前置圖示正下方的小字（章節清單的「12分鐘」）；傳空字串＝不顯示文字但仍保留同寬的欄位，各列文字才會對齊。 */
  note?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  unread?: boolean;
  /** 整列加明顯底色（例如正在播放的章節）。 */
  highlight?: boolean;
  /** 緊湊列高（章節清單用）。 */
  dense?: boolean;
  /** 章節清單的精簡版：不顯示右側「>」、標題只佔一行（太長用「…」）、文字更靠近邊框（外層 Card 的左右內距請用 space.sm）。 */
  compact?: boolean;
  /** 正在播放這一列：前置圖示固定是會動的實心三角形（優先於 icon／leading）。 */
  playing?: boolean;
  /** 這一列的章節編號：讓圖示只認「播放器目前播的就是這一堂」的狀態（換章節的空檔不會誤用上一堂的播放／暫停狀態）。 */
  playingLesson?: string;
  /** 標題最多幾行（超過「…」）；預設 compact＝1 行。清單（素材）頁用 2 行。 */
  titleLines?: number;
  /** 日期膠囊：接在標題最前面，跟標題一起排版，整列最多 titleLines 行（杜杜龍 2026-11-18）。 */
  dateChip?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={({ pressed }) => [styles.row, dense && { minHeight: minTouch, paddingVertical: space.sm }, compact && { gap: 4, minHeight: 0, paddingVertical: 3 }, { borderBottomColor: c.border }, highlight && { backgroundColor: c.accentSoft, borderRadius: radius.md, marginHorizontal: compact ? -space.sm : -space.lg, paddingHorizontal: compact ? space.sm : space.lg }, pressed && { opacity: 0.7 }]}
    >
      {note !== undefined ? (
        <View style={{ width: Math.round(42 * UI_SCALE), alignItems: "center", gap: 0 }}>
          {playing ? <NowPlayingIcon lessonId={playingLesson} /> : leading ?? (icon ? <Icon name={icon} size={36} color={c.textMuted} /> : null)}
          {note ? (
            <AppText variant="caption" tone="muted" numberOfLines={1} style={{ fontSize: 11, lineHeight: 12 }}>
              {note}
            </AppText>
          ) : null}
        </View>
      ) : (
        leading ?? (icon ? <Icon name={icon} size={22} color={c.textMuted} /> : null)
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="headline" numberOfLines={titleLines ?? (compact ? 1 : undefined)} style={unread ? undefined : { fontWeight: "500" }}>
          {dateChip ? <Text style={[styles.chip, { backgroundColor: c.accentSoft, color: c.accentText }]}>{` ${dateChip} `}</Text> : null}
          {dateChip ? " " : ""}
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="callout" tone="muted" numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {unread ? <View style={[styles.dot, { backgroundColor: c.accent }]} accessibilityLabel="未讀" /> : null}
      {right ?? (onPress && !compact ? <Icon name="chevron-forward" size={18} color={c.textMuted} /> : null)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: minTouch + 8,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chip: { fontSize: 12, lineHeight: 18, fontWeight: "700", borderRadius: 9, overflow: "hidden" },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
