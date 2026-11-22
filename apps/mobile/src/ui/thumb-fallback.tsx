import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";

/**
 * 沒有圖片時的預設封面：綠色學士帽（業主 2026-11-21 永久指示，全站統一；2026-11-22 擴大到「所有封面」）。
 * 放進封面／縮圖框裡會自動鋪滿；不傳 `size` 時帽子大小跟著方框走（約短邊的 40%，最小 22、最大 96），
 * 小縮圖與大封面都適用。所有封面、縮圖沒圖時一律用它，不可留空白方塊、也不可改用文字封面或別的圖示
 * （唯一例外：固定格式文字封面，見 `CourseCover`）。
 */
export function ThumbFallback({ size }: { size?: number }) {
  const { c } = useTheme();
  const [box, setBox] = useState(0);
  const icon = size ?? Math.max(22, Math.min(96, Math.round(box * 0.4)));
  return (
    <View style={[StyleSheet.absoluteFill, styles.box, { backgroundColor: c.accentSoft }]} accessible={false} onLayout={(e) => setBox(Math.min(e.nativeEvent.layout.width, e.nativeEvent.layout.height))}>
      <Ionicons name="school-outline" size={icon} color={c.accent} />
    </View>
  );
}

const styles = StyleSheet.create({ box: { alignItems: "center", justifyContent: "center" } });
