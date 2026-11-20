import { Platform } from "react-native";

/** 全站 viewport：鎖定 1 倍、不可縮放（平板的放大改由 theme/ui-scale.ts 放大字體、圖示與按鈕，2026-11-18）。部署時 index.html 也寫入同一組（embed-static.mjs）。 */
export const VIEWPORT = "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

/**
 * 整個網站（網頁版）禁止雙指放大縮小整體頁面，讓網頁與手機 App 的行為一致。
 * 影片區塊自己的雙指放大（Mux／YouTube）與圖片小視窗的放大不受影響（它們有自己的手勢處理）。
 * 做法：viewport 鎖定 1 倍、整頁 touch-action 只允許上下左右捲動、擋掉 iOS Safari 的 gesture 事件與電腦觸控板的 Ctrl＋滾輪縮放。
 */
export function installNoPageZoom(): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => undefined;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "viewport";
    document.head.appendChild(meta);
  }
  meta.content = VIEWPORT;
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
  // iPad Safari 會忽略 user-scalable=no，而且捲動區塊裡的元素可能不受 html 的 touch-action 限制：
  // 另外在最外層（capture）攔截所有雙指的 touchstart／touchmove／gesture 事件（業主永久指示：不開放頁面雙指縮放）。
  // 影片與照片的雙指縮放是它們自己用手勢計算位置，這裡只取消瀏覽器預設的整頁縮放，不影響它們。
  const opts = { passive: false, capture: true } as const;
  window.addEventListener("touchstart", touch, opts);
  window.addEventListener("touchmove", touch, opts);
  for (const n of ["gesturestart", "gesturechange", "gestureend"]) window.addEventListener(n, stop, opts);
  document.addEventListener("gesturestart", stop);
  document.addEventListener("gesturechange", stop);
  document.addEventListener("gestureend", stop);
  document.addEventListener("wheel", wheel, { passive: false });
  document.addEventListener("touchmove", touch, { passive: false });
  return () => {
    window.removeEventListener("touchstart", touch, opts);
    window.removeEventListener("touchmove", touch, opts);
    for (const n of ["gesturestart", "gesturechange", "gestureend"]) window.removeEventListener(n, stop, opts);
    style.remove();
    document.removeEventListener("gesturestart", stop);
    document.removeEventListener("gesturechange", stop);
    document.removeEventListener("gestureend", stop);
    document.removeEventListener("wheel", wheel);
    document.removeEventListener("touchmove", touch);
  };
}
