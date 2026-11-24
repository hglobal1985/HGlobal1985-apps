import { Platform } from "react-native";

/**
 * 至尊模式改字體／加粗時根版面會整個重建（`app/_layout.tsx` 的 elder key），畫面會跳回頁首（業主 2026-11-24 回報）。
 * 網頁：平常記住「最後捲動的那個區塊」的位置比例；重建後把最大的可捲動區塊捲回同樣的比例（字變大高度會變，所以用比例）。
 * App：沒有這個問題的觀察點，先不處理。
 */
let ratio = 0;
let installed = false;

function install() {
  if (installed || Platform.OS !== "web" || typeof document === "undefined") return;
  installed = true;
  document.addEventListener(
    "scroll",
    (e) => {
      const t = e.target as HTMLElement | Document;
      const el = t instanceof HTMLElement ? t : document.scrollingElement;
      if (el && el.scrollHeight > el.clientHeight) ratio = el.scrollTop / el.scrollHeight;
    },
    { capture: true, passive: true },
  );
}

/** 開機時呼叫一次，開始記錄位置。 */
export function trackScroll() {
  install();
}

/** 重建後呼叫：把頁面捲回重建前的位置（內容還在載入時多試幾次）。 */
export function restoreScroll() {
  if (Platform.OS !== "web" || typeof document === "undefined" || ratio <= 0) return;
  const target = ratio;
  let tries = 0;
  const go = () => {
    let best: HTMLElement | null = null;
    document.querySelectorAll<HTMLElement>("div").forEach((el) => {
      if (el.scrollHeight <= el.clientHeight + 4) return;
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && (!best || el.scrollHeight > best.scrollHeight)) best = el;
    });
    const b = best as HTMLElement | null;
    if (b) b.scrollTop = Math.round(target * b.scrollHeight);
    if (++tries < 8) requestAnimationFrame(go);
  };
  requestAnimationFrame(go);
}
