import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Icon } from "@/ui";

/** 「單元」模式的篩選（三選一，同時只能選一個；再點一次取消＝全部顯示）。 */
export type UnitFilterValue = "all" | "speaker" | "noshorts" | "shorts";

const OPTIONS: { key: Exclude<UnitFilterValue, "all">; label: string }[] = [
  { key: "speaker", label: "只看主講" },
  { key: "noshorts", label: "隱藏短影音" },
  { key: "shorts", label: "只看短影音" },
];

/** 單元清單套用篩選：只看主講＝主講人章節；隱藏短影音／只看短影音＝依課程是否為「短影音專輯」。 */
export const unitFilterPass = (f: UnitFilterValue, l: { isSpeaker?: boolean; isShorts?: boolean }) => (f === "speaker" ? !!l.isSpeaker : f === "noshorts" ? !l.isShorts : f === "shorts" ? !!l.isShorts : true);

export function UnitFilter({ value, onChange }: { value: UnitFilterValue; onChange: (v: UnitFilterValue) => void }) {
  const { c } = useTheme();
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {OPTIONS.map((o) => {
        const on = value === o.key;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(on ? "all" : o.key)}
            style={[styles.item, { borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accentSoft : c.surface }]}
          >
            <Icon name={on ? "checkbox" : "square-outline"} size={22} color={on ? c.accent : c.textMuted} />
            <AppText variant="callout" numberOfLines={1} style={{ color: on ? c.accentText : c.text, fontWeight: on ? "700" : "400" }}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.xs, paddingTop: space.xs },
  item: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 4 },
});
