import { Platform } from "react-native";
import { viewportContent } from "./tablet-scale";

/**
 * 整個網站（網頁版）禁止雙指放大縮小整體頁面，讓網頁與手機 App 的行為一致。
 * 影片區塊自己的雙指放大（Mux／YouTube）與圖片小視窗的放大不受影響（它們有自己的手勢處理）。
 * 做法：viewport 鎖定倍數（手機 1 倍、平板見 tablet-scale.ts）、整頁 touch-action 只允許上下左右捲動、擋掉 iOS Safari 的 gesture 事件與電腦觸控板的 Ctrl＋滾輪縮放。
 */
export function installNoPageZoom(): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => undefined;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "viewport";
    document.head.appendChild(meta);
  }
  // 手機鎖定 1 倍；平板鎖定在放大後的倍數（tablet-scale.ts，業主 2026-11-18）。
  meta.content = viewportContent();
  const style = document.createElement("style");
  style.textContent = "html,body{touch-action:pan-x pan-y;-webkit-text-size-adjust:100%;text-size-adjust:100%}";
  document.head.appendChild(style);
  const stop = (e: Event) => e.preventDefault();
  const wheel = (e: WheelEvent) => {
    if (e.ctrlKey) e.preventDefault();
  };
  const touch = (e: TouchEvent) => {
    if (e.touches.length > 1) e.preventDefault();
  };
  document.addEventListener("gesturestart", stop);
  document.addEventListener("gesturechange", stop);
  document.addEventListener("gestureend", stop);
  document.addEventListener("wheel", wheel, { passive: false });
  document.addEventListener("touchmove", touch, { passive: false });
  return () => {
    style.remove();
    document.removeEventListener("gesturestart", stop);
    document.removeEventListener("gesturechange", stop);
    document.removeEventListener("gestureend", stop);
    document.removeEventListener("wheel", wheel);
    document.removeEventListener("touchmove", touch);
  };
}
