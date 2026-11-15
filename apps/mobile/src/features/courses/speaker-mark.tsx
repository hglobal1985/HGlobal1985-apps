import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/theme";

/** 主講人章節的特殊標記（學士帽圖示）：章節清單、上課頁章節、單元頁都用這一個，要改圖示只改這裡。 */
export function SpeakerMark({ size = 18 }: { size?: number }) {
  const { c } = useTheme();
  return <Ionicons name="school" size={size} color={c.accent} accessibilityLabel="主講人" />;
}
