import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Icon } from "@/ui";

/**
 * 「單元」模式的篩選：兩顆「眼睛」按鈕（業主 2026-11-16 定案）。
 * - 「只看主講」：開＝只列主講人章節；關＝全部都看。
 * - 「只看短影音」：開＝只列短影音專輯的章節與影音教材；關＝全部都看。
 * 開啟＝眼睛張開、深綠底；關閉＝眼睛劃斜線、灰色；開啟「只看短影音」時「只看主講」強制關閉、變淡灰色且不能按。
 * 關閉「只看短影音」不影響（之後仍可打開「只看主講」，但不會自動恢復原本開著的主講）。
 */
export type UnitFilterValue = "all" | "speaker" | "shorts";

/** 單元清單套用篩選。 */
export const unitFilterPass = (f: UnitFilterValue, l: { isSpeaker?: boolean; isShorts?: boolean }) => (f === "speaker" ? !!l.isSpeaker : f === "shorts" ? !!l.isShorts : true);

/** 讀取已存的選擇（舊版的「隱藏短影音」已取消，視為全部）。 */
export const parseUnitFilter = (v: string | null | undefined): UnitFilterValue => (v === "speaker" || v === "shorts" ? v : "all");

export function UnitFilter({ value, onChange }: { value: UnitFilterValue; onChange: (v: UnitFilterValue) => void }) {
  return (
    <View style={styles.row}>
      <EyeButton label="只看短影音" state={value === "shorts" ? "on" : "off"} onPress={() => onChange(value === "shorts" ? "all" : "shorts")} />
      <EyeButton label="只看主講" state={value === "shorts" ? "disabled" : value === "speaker" ? "on" : "off"} onPress={() => onChange(value === "speaker" ? "all" : "speaker")} />
    </View>
  );
}

function EyeButton({ label, state, onPress }: { label: string; state: "on" | "off" | "disabled"; onPress: () => void }) {
  const { c } = useTheme();
  const on = state === "on";
  const disabled = state === "disabled";
  const fg = on ? c.textOnAccent : disabled ? c.border : c.textMuted;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.item, { backgroundColor: on ? c.accent : disabled ? c.surfaceMuted : c.surface, borderColor: on ? c.accent : disabled ? c.surfaceMuted : c.border }]}
    >
      <Icon name={on ? "eye" : "eye-off"} size={22} color={fg} />
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
