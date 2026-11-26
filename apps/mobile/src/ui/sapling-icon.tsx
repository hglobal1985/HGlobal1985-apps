import Svg, { Ellipse, Path } from "react-native-svg";
import { useTheme } from "@/theme/theme";

/**
 * 小樹苗圖示（杜杜龍 2026-11-16 選定第 12 號：幼苗＋土堆）。「已完成」的章節與學習成就一律用它；
 * 每學完一堂課（播放超過完成門檻）就累積一棵小樹苗。
 */
export function SaplingIcon({ size = 36 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 36 36" accessibilityLabel="小樹苗">
      <Ellipse cx="18" cy="31" rx="12" ry="4" fill="#8A5A2B" />
      <Path d="M18 29V17" stroke={c.accent} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      <Path d="M18 19C11 20 7 16 7 11c7 0 11 3 11 8z" fill={c.accent} />
      <Path d="M18 16C18 10 21 7 28 7c0 6-3 10-10 9z" fill="#4F9D69" />
    </Svg>
  );
}
