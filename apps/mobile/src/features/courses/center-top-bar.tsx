import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { barHeight, space } from "@/theme/tokens";
import { AppText } from "@/ui";

/**
 * 中心專屬頁的置頂工具列（左邊返回鍵＋中心名稱）：只在選了某個中心時出現，取代原本的「放大鏡／分類／三種檢視」整排，
 * 讓使用者能回到中心清單。樣式與全站上方標題列一致（同高、返回鍵 48px）。
 */
export function CenterTopBar({ title, onBack }: { title: string; onBack: () => void }) {
  const { c } = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: c.surface }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回中心清單" hitSlop={8} onPress={onBack} style={styles.back}>
        <Ionicons name="arrow-back" size={26} color={c.text} />
      </Pressable>
      <AppText variant="headline" numberOfLines={1} style={{ flex: 1 }}>
        {title}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", minHeight: barHeight, marginHorizontal: -space.lg, paddingHorizontal: space.lg },
  back: { width: 48, height: 48, alignItems: "center", justifyContent: "center", marginLeft: -8 },
});
