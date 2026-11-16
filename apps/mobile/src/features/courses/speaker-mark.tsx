import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import { useTheme } from "@/theme/theme";

/** 章節清單最前面的特大學士帽（取代播放圖示；外框寬度與一般圖示相同，文字對齊不變，帽子向兩側溢出）。 */
export function SpeakerLead() {
  return (
    <View style={{ width: 22, alignItems: "center", justifyContent: "center" }}>
      <SpeakerMark size={36} />
    </View>
  );
}

/** 主講人章節的特殊標記（學士帽圖示）：章節清單、上課頁章節、單元頁都用這一個，要改圖示只改這裡。 */
export function SpeakerMark({ size = 18 }: { size?: number }) {
  const { c } = useTheme();
  return <Ionicons name="school" size={size} color={c.accent} accessibilityLabel="主講人" />;
}
