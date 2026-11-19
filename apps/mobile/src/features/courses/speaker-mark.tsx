import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import { useTheme } from "@/theme/theme";

/** 章節清單最前面的特大學士帽（取代播放圖示；大小與章節清單的播放圖示相同，都是 36）。 */
export function SpeakerLead() {
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <SpeakerMark size={36} />
    </View>
  );
}

/** 「主題」（原主講人）的特殊標記（學士帽圖示）：章節清單、上課頁章節、單元頁都用這一個，要改圖示只改這裡。 */
export function SpeakerMark({ size = 18 }: { size?: number }) {
  const { c } = useTheme();
  return <Ionicons name="school" size={size} color={c.accent} accessibilityLabel="主題" />;
}
