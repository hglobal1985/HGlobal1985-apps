import { Platform } from "react-native";

/**
 * 網頁版「真正的全螢幕」（杜杜龍 2026-11-21）：瀏覽器的網址列、按鈕全部收起，只剩畫面內容。
 * 必須在使用者點擊後不久呼叫（瀏覽器規定）；不支援的環境（例如 iPhone 的 Safari 不允許一般網頁全螢幕）安靜略過，仍是鋪滿整個畫面。
 * 全站要進全螢幕的畫面（照片放大、日後的影片全螢幕…）一律用這兩個函式，不要自己呼叫瀏覽器的全螢幕功能。
 */
/** iPad（含「電腦版網站」偽裝成 Mac 的 iPad）：進瀏覽器全螢幕後，從上往下滑會跳出系統的「離開全螢幕」提示列、左上角還有系統的 ✕ 鈕蓋住畫面上的按鈕，網頁擋不住這個手勢（杜杜龍 2026-11-25）。所以 iPad 不進瀏覽器全螢幕，改成畫面內鋪滿。 */
const isIpad = () => typeof navigator !== "undefined" && (/iPad/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
export function enterFullscreen(): void {
  if (Platform.OS !== "web" || typeof document === "undefined" || isIpad()) return;
  try {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    if (document.fullscreenElement) return;
    const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: "hide" }) : el.webkitRequestFullscreen?.();
    void Promise.resolve(p).catch(() => undefined);
  } catch {
    /* 不支援就略過 */
  }
}
export function exitFullscreen(): void {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  try {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  } catch {
    /* 略過 */
  }
}
