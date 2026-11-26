import { Pressable, StyleSheet, View } from "react-native";
import { useBorderW } from "@/lib/elder-mode";
import { LoadingLadybug } from "./loading-ladybug";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { Icon, type IconName } from "./icon";
import { AppText } from "./text";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "cancel" | "dangerSolid";

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  disabled,
  loading,
  fullWidth,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
}) {
  const { c } = useTheme();
  const bw = useBorderW(1);
  const look = {
    primary: { bg: c.accent, fg: c.textOnAccent, border: c.accent },
    secondary: { bg: c.surface, fg: c.text, border: c.border },
    ghost: { bg: "transparent", fg: c.accentText, border: "transparent" },
    danger: { bg: c.dangerSoft, fg: c.danger, border: c.dangerSoft },
    // 取消／關閉／放棄：紅色外框＋紅字＋不填色（杜杜龍 2026-11-19 全站統一）；儲存／確定一律用 primary（深綠）。
    cancel: { bg: "transparent", fg: c.danger, border: c.danger },
    // 危險動作的確認（刪除、移除…）：實心紅底白字。
    dangerSolid: { bg: c.danger, fg: "#fff", border: c.danger },
  }[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: look.bg, borderColor: look.border, borderWidth: bw },
        fullWidth && { alignSelf: "stretch" },
        inactive && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={styles.row}>
        {loading ? <LoadingLadybug size={28} /> : icon ? <Icon name={icon} color={look.fg} size={18} /> : null}
        <AppText variant="headline" numberOfLines={1} style={{ color: look.fg }}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: minTouch,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
