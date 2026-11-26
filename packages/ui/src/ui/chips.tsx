import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText } from "./text";

/** 單選的圓角選項列（自訂元件，不使用原生下拉）。 */
export function Chips<T extends string>({ options, value, onChange, label, title }: { options: { key: T; label: string }[]; value: T | null; onChange: (key: T) => void; label?: string; /** 顯示在選項上方的標題（杜杜龍 2026-11-18：選項列一定要有看得到的標題；label 只給讀屏）。 */ title?: string }) {
  const { c } = useTheme();
  const row = (
    <View style={styles.row} accessibilityLabel={label ?? title}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.chip, { backgroundColor: active ? c.accent : c.surface, borderColor: active ? c.accent : c.border }]}
          >
            <AppText variant="callout" style={{ color: active ? c.textOnAccent : c.text, fontWeight: "600" }}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
  if (!title) return row;
  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="callout" tone="muted" style={{ fontWeight: "700" }}>
        {title}
      </AppText>
      {row}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { minHeight: minTouch - 8, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, justifyContent: "center" },
});
