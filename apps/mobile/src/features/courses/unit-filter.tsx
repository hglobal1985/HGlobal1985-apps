import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Icon } from "@/ui";

/**
 * 「單元」模式的篩選：兩顆「眼睛」按鈕（業主 2026-11-16 定案）。
 * 「短影音」按鈕每按一下循環三種狀態：
 *   灰色「短影音開關」（沒篩選，全部顯示）→ 綠色「只看短影音」→ 斜線「不看短影音」→ 回到灰色。
 * 「主講」按鈕兩種狀態：灰色「全部顯示」↔ 綠色「只看主講」。
 * 開「只看短影音」時，主講按鈕強制關閉、變淡灰色不能按；其他狀態不受影響（主講被強制關閉後不會自動恢復）。
 * 值的寫法：主講開才加上 speaker；短影音狀態 shorts（只看）／noshorts（不看）。
 */
export type UnitFilterValue = "all" | "speaker" | "shorts" | "noshorts" | "speaker_noshorts";
type ShortsMode = "off" | "only" | "hide";

const shortsOf = (v: UnitFilterValue): ShortsMode => (v === "shorts" ? "only" : v === "noshorts" || v === "speaker_noshorts" ? "hide" : "off");
const speakerOf = (v: UnitFilterValue) => v === "speaker" || v === "speaker_noshorts";
const compose = (shorts: ShortsMode, speaker: boolean): UnitFilterValue => (shorts === "only" ? "shorts" : shorts === "hide" ? (speaker ? "speaker_noshorts" : "noshorts") : speaker ? "speaker" : "all");

/** 單元清單套用篩選。 */
export const unitFilterPass = (f: UnitFilterValue, l: { isSpeaker?: boolean; isShorts?: boolean }) => {
  const shorts = shortsOf(f);
  if (speakerOf(f) && !l.isSpeaker) return false;
  return shorts === "only" ? !!l.isShorts : shorts === "hide" ? !l.isShorts : true;
};

/** 讀取已存的選擇（不認得的值視為全部）。 */
export const parseUnitFilter = (v: string | null | undefined): UnitFilterValue => (v === "speaker" || v === "shorts" || v === "noshorts" || v === "speaker_noshorts" ? v : "all");

export function UnitFilter({ value, onChange }: { value: UnitFilterValue; onChange: (v: UnitFilterValue) => void }) {
  const shorts = shortsOf(value);
  const speaker = speakerOf(value);
  const nextShorts: ShortsMode = shorts === "off" ? "only" : shorts === "only" ? "hide" : "off";
  return (
    <View style={styles.row}>
      <FilterButton
        kind={shorts === "only" ? "on" : shorts === "hide" ? "hide" : "off"}
        label={shorts === "only" ? "只看短影音" : shorts === "hide" ? "不看短影音" : "短影音開關"}
        onPress={() => onChange(compose(nextShorts, nextShorts === "only" ? false : speaker))} // 開「只看短影音」＝主講強制關閉
      />
      <FilterButton kind={shorts === "only" ? "disabled" : speaker ? "on" : "off"} label={speaker ? "只看主講" : "全部顯示"} onPress={() => onChange(compose(shorts, !speaker))} />
    </View>
  );
}

/** on＝綠色眼睛張開；off＝灰色眼睛（不劃線）；hide＝眼睛劃斜線（不看）；disabled＝更淡的灰色、不能按。 */
function FilterButton({ label, kind, onPress }: { label: string; kind: "on" | "off" | "hide" | "disabled"; onPress: () => void }) {
  const { c } = useTheme();
  const on = kind === "on";
  const disabled = kind === "disabled";
  const hide = kind === "hide";
  const fg = on ? c.textOnAccent : hide ? c.accentText : disabled ? c.border : c.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on || hide, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.item, { backgroundColor: on ? c.accent : hide ? c.accentSoft : disabled ? c.surfaceMuted : c.surface, borderColor: on ? c.accent : hide ? c.accent : disabled ? c.surfaceMuted : c.border }]}
    >
      <Icon name={hide ? "eye-off" : "eye"} size={22} color={fg} />
      <AppText variant="callout" numberOfLines={1} style={{ color: fg, fontWeight: "700" }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.sm, paddingTop: space.xs },
  item: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.sm },
});
