import { Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/theme/theme";
import { minTouch, space } from "@/theme/tokens";
import { AppText, Icon } from "@/ui";

/** 「單元」模式的「只顯示主講人」開關：打開後單元清單只列各課程被勾選為「主講人」的那一堂（每門課最多一堂）。 */
export function SpeakerToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value }} accessibilityLabel="只顯示主講人" onPress={() => onChange(!value)} style={styles.row}>
      <Icon name={value ? "checkbox" : "square-outline"} size={28} color={value ? c.accent : c.textMuted} />
      <AppText variant="body" style={{ fontWeight: value ? "700" : "400" }}>
        只顯示主講人
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: minTouch, paddingTop: space.xs, alignSelf: "flex-start" },
});
