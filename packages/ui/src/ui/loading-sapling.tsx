import { ActivityIndicator, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";

/** iOS／Android：先用系統轉圈圈（灌溉小樹苗動畫目前只有網頁版，見 loading-sapling.web.tsx；App 上架前再補）。 */
export function LoadingSapling({ compact = false }: { compact?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ padding: compact ? space.sm : space.xxl, alignItems: "center" }} accessibilityLabel="載入中">
      <ActivityIndicator color={c.accentText} />
    </View>
  );
}
