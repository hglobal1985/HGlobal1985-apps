import { Text, type TextProps } from "react-native";
import { useTheme } from "@/theme/theme";
import { type, type TypeVariant } from "@/theme/tokens";

export type TextTone = "default" | "muted" | "accent" | "danger" | "warning" | "success" | "onAccent";

export function AppText({
  variant = "body",
  tone = "default",
  style,
  ...rest
}: TextProps & { variant?: TypeVariant; tone?: TextTone }) {
  const { c } = useTheme();
  const sized = type[variant]; // 放大由 lib/global-scale.ts 在 Text 底層統一處理
  const color = {
    default: c.text,
    muted: c.textMuted,
    accent: c.accentText,
    danger: c.danger,
    warning: c.warning,
    success: c.success,
    onAccent: c.textOnAccent,
  }[tone];
  return <Text {...rest} style={[sized, { color }, style]} />;
}
