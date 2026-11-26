import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/theme/theme";
import { minTouch, space } from "@/theme/tokens";
import { AppText } from "./text";

/** 勾選框（整列可點、觸控夠大）。全站勾選框統一用它（2026-11-21 由 course-sections.tsx 搬來）。 */
export function Check({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value, disabled }} disabled={disabled} onPress={() => onChange(!value)} style={[styles.check, disabled && { opacity: 0.5 }]}>
      <Ionicons name={value ? "checkbox" : "square-outline"} size={28} color={value ? c.accent : c.textMuted} />
      <AppText variant="body" style={{ flex: 1 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  check: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouch },
});
