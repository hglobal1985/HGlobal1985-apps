import { useSyncExternalStore } from "react";

/**
 * 頁面捲動位移（像素，網頁版）：聽頁面「主要的上下捲動區」（高度夠、真的能捲）的 scroll 事件，與全站播放器（player-layer.web.tsx）判斷同一個捲動區。
 * 全站只裝一個監聽，所有「下滑縮小」的封面共用。
 */
let y = 0;
let on = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
function listen() {
  if (on || typeof window === "undefined") return;
  on = true;
  window.addEventListener(
    "scroll",
    (e) => {
      const el = e.target as HTMLElement | null;
      if (!el || el === (document as unknown)) return;
      // 頁面主要捲動區（Screen 的 Scroller 有 data-stable-gutter 標記）一律算，不管視窗多矮；其他的捲動區要夠高、真的能捲才算。
      if (!el.hasAttribute?.("data-stable-gutter") && (el.clientHeight < 200 || el.scrollHeight - el.clientHeight < 40)) return;
      const n = Math.max(0, Math.round(el.scrollTop));
      if (n === y) return;
      y = n;
      emit();
    },
    true,
  );
}
export function useBandScroll(): number {
  return useSyncExternalStore(
    (f) => (listen(), subs.add(f), () => void subs.delete(f)),
    () => y,
    () => 0,
  );
}
/** 換頁或重新進入時歸零（舊頁的捲動位置不能留給新頁）。 */
export function resetBandScroll() {
  if (y === 0) return;
  y = 0;
  emit();
}
