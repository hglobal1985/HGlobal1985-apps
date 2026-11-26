import type { ReactNode } from "react";
import { View } from "react-native";
import { useTheme } from "@/theme/theme";

/** iOS／Android：先用單色邊框（流光漸層邊框目前只有網頁版，見 gradient-frame.web.tsx；App 上架前補）。 */
export function GradientFrame({ width, height, radius = 20, children }: { width: number | string; height: number | string; radius?: number; running?: boolean; flush?: boolean; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ width: width as number, height: height as number, borderRadius: radius, borderWidth: 4, borderColor: c.accent, backgroundColor: c.surface, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 8, overflow: "hidden" }}>{children}</View>
  );
}
