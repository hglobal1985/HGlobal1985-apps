import Svg, { Path } from "react-native-svg";

/**
 * 「寰宇大學」分頁的建築物圖示（有柱子的學院）。自己畫成 SVG，不用 MaterialCommunityIcons：
 * 那個圖示字型有 1.3MB，只為了一個圖示就讓每個人開啟網站都多下載一大包（業主 2026-11-17 回報變慢）。
 * active＝實心；未選取＝線條。
 */
export function UniversityIcon({ size = 24, color, active }: { size?: number; color: string; active?: boolean }) {
  const d = "M12 2.5 2.5 7v2h19V7zM5 11v6h3v-6zm5.5 0v6h3v-6zm5.5 0v6h3v-6zM2.5 19v2.5h19V19z";
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={d} fill={active ? color : "none"} stroke={color} strokeWidth={active ? 0 : 1.6} strokeLinejoin="round" />
    </Svg>
  );
}
