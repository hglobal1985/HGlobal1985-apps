import Svg, { Path } from "react-native-svg";

/** 至尊模式的皇冠圖示（自己畫的 SVG，不另外下載圖示字型）。size 是實際像素，不吃全站放大。 */
export function CrownIcon({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M3 7.5 7.5 11 12 4l4.5 7L21 7.5 19.5 18h-15z M4.5 19.5h15V21h-15z" fill={color} strokeLinejoin="round" />
    </Svg>
  );
}
