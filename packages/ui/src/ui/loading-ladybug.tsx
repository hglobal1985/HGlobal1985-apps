import { ActivityIndicator } from "react-native";
import { useTheme } from "@/theme/theme";

/** iOS／Android：先用系統轉圈圈（小瓢蟲動畫目前只有網頁版，見 loading-ladybug.web.tsx；App 上架前補）。 */
export function LoadingLadybug({ size = 44 }: { size?: number }) {
  const { c } = useTheme();
  return <ActivityIndicator size={size > 30 ? "large" : "small"} color={c.accentText} accessibilityLabel="載入中" />;
}
