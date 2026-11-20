import { Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius } from "@/theme/tokens";
import { Icon } from "./icon";

/** 編輯清單每列右側的小方形按鈕（上移、下移、編輯、複製、刪除…）。外觀 28×28，但觸控範圍四周各多 8（共 44），手機上好按。2026-11-21 由 course-edit/lessons.tsx 搬來共用。 */
export function IconButton({ icon, label, onPress, disabled, danger }: { icon: "arrow-up" | "arrow-down" | "trash-outline" | "create-outline" | "copy-outline" | "folder-open-outline"; label: string; onPress?: () => void; disabled?: boolean; danger?: boolean }) {
  const { c } = useTheme();
  const off = disabled || !onPress;
  return (
    <Pressable onPress={onPress} disabled={off} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={[styles.iconBtn, { borderColor: c.border, opacity: off ? 0.35 : 1 }]}>
      <Icon name={icon} size={14} color={danger ? c.danger : c.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  iconBtn: { width: 28, height: 28, borderRadius: radius.sm, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
