import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import { useTheme } from "@/theme/theme";

/** 章節清單最前面的特大「總結」圖示（取代播放圖示；大小與主講人的學士帽、播放圖示相同，都是 36）。 */
export function SummaryLead() {
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <SummaryMark size={36} />
    </View>
  );
}

/** 「總結與銷售課程」章節的特殊標記（電源圖示＝結束，杜杜龍 2026-11-16 選定）：章節清單、單元頁都用這一個，要改圖示只改這裡。 */
export function SummaryMark({ size = 18 }: { size?: number }) {
  const { c } = useTheme();
  return <Ionicons name="power" size={size} color={c.accent} accessibilityLabel="總結與銷售課程" />;
}
