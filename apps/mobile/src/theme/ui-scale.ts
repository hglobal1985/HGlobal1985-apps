import { Platform } from "react-native";

/**
 * 介面整體放大倍數（業主 2026-11-18：iPad 的字體與按鈕要比手機大很多；圖片展示尺寸不動）。
 * 開啟網站時決定一次：觸控平板（螢幕短邊 ≥ 600，例如 iPad）1.3 倍；電腦寬螢幕（≥ 900、非觸控）1.1 倍；手機 1 倍。
 * 套用範圍：全站所有文字（lib/global-scale.ts 統一處理，連沒用 AppText 的也有）、所有圖示、按鈕與工具列高度（tokens.ts 的 minTouch、barHeight）。
 * 圖片、海報、封面、影片舞台的尺寸不受影響。要調大小只改這裡的兩個數字。
 * 注意：不用瀏覽器 viewport 放大（iPad Safari 不一定理會，而且會連圖片一起放大）。
 */
export const TABLET_UI_SCALE = 1.3;
export const DESKTOP_UI_SCALE = 1.1;

function decide(): number {
  if (Platform.OS !== "web" || typeof window === "undefined" || typeof screen === "undefined") return 1;
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || "ontouchstart" in window;
  const shortSide = Math.min(screen.width, screen.height);
  if (touch) return shortSide >= 600 ? TABLET_UI_SCALE : 1;
  return window.innerWidth >= 900 ? DESKTOP_UI_SCALE : 1;
}
export const UI_SCALE = decide();
