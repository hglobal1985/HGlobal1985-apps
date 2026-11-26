import Svg, { Path } from "react-native-svg";

/**
 * 「加入我的清單」圖示（杜杜龍 2026-11-21）：三條橫線＋加號；已加入時加號換成打勾。全站所有加入清單的按鈕共用。
 */
export function ListIcon({ size = 22, color, added }: { size?: number; color: string; added?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M4 6h11M4 11h11M4 16h6" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
      {added ? <Path d="M16 17l2.2 2.2L22 15" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /> : <Path d="M18 13v8M14 17h8" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />}
    </Svg>
  );
}
