import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { Icon } from "./icon";
import { AppText } from "./text";

/** 一個「減／數字／加」的調整列（設定頁的數字設定共用；2026-11-21 由 app/admin/storage.tsx 搬來）。 */
export function Stepper({ label, hint, value, min, max, step, unit, onChange }: { label: string; hint: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  const { c } = useTheme();
  return (
    <View style={styles.legend}>
      <View style={{ flex: 1 }}>
        <AppText variant="body">{label}</AppText>
        <AppText variant="caption" tone="muted">
          {hint}
        </AppText>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}減少`} disabled={value <= min} onPress={() => onChange(Math.max(min, value - step))} style={[styles.step, { borderColor: c.border, opacity: value <= min ? 0.35 : 1 }]}>
        <Icon name="remove" size={22} color={c.text} />
      </Pressable>
      <AppText variant="headline" style={{ minWidth: 76, textAlign: "center" }}>
        {value}
        {unit}
      </AppText>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}增加`} disabled={value >= max} onPress={() => onChange(Math.min(max, value + step))} style={[styles.step, { borderColor: c.border, opacity: value >= max ? 0.35 : 1 }]}>
        <Icon name="add" size={22} color={c.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: "row", alignItems: "center", gap: space.sm },
  step: { width: 40, height: 40, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
