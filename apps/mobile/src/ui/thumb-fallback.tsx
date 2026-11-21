import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";

/**
 * 小縮圖沒有圖片時的預設圖：綠色學士帽（業主 2026-11-21 永久指示，全站統一）。
 * 放進縮圖框裡會自動鋪滿；所有「清單列、上拉選單列」的小縮圖沒圖時一律用它，不可再留空白方塊或各自畫別的圖示。
 * （大張的封面卡片沿用各自的文字封面規則，不在此列。）
 */
export function ThumbFallback({ size = 22 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, styles.box, { backgroundColor: c.accentSoft }]} accessible={false}>
      <Ionicons name="school-outline" size={size} color={c.accent} />
    </View>
  );
}

const styles = StyleSheet.create({ box: { alignItems: "center", justifyContent: "center" } });
