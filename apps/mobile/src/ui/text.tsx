import { Text, useWindowDimensions, type TextProps } from "react-native";
import { layoutOf } from "@/theme/layout";
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
  // 電腦寬螢幕文字放大（業主 2026-11-18，theme/layout.ts 的 textScale）；手機、平板維持字級本身（平板已整體放大）。
  const { width, height } = useWindowDimensions();
  const k = layoutOf(width, height).textScale;
  const base = type[variant];
  const sized = k === 1 ? base : { ...base, fontSize: Math.round(base.fontSize * k), lineHeight: Math.round(base.lineHeight * k) };
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
