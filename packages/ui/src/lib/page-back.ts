import { useEffect, useRef } from "react";

/**
 * 上方工具列「返回鍵」的頁面內攔截（杜杜龍 2026-11-26）：相簿是一個頁面、裡面有好幾層（類別 → 資料夾 → 照片、食譜列表 → 單道食譜 → 編輯），
 * 畫面裡不再各放一顆返回鈕，一律由上方工具列 `TopBar` 的返回鍵處理——按下去先問這裡「目前最上層」的畫面要不要自己退一層。
 * 用法：`usePageBack(() => { 能退一層就退並回傳 true；已在最上層回傳 false（交給下一個或離開頁面） }, 優先序)`。
 * 優先序大的先處理（相簿看圖 1 → 相簿資料夾／類別 2 → 食譜專區 3 → 單道食譜 4 → 編輯整頁 5 → 面板 6）；同優先序後登記的先處理。
 */
type Handler = { p: number; seq: number; fn: () => boolean };
let seq = 0;
const handlers: Handler[] = [];

export function usePageBack(fn: () => boolean, priority: number, enabled = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const h: Handler = { p: priority, seq: ++seq, fn: () => ref.current() };
    handlers.push(h);
    return () => void handlers.splice(handlers.indexOf(h), 1);
  }, [priority, enabled]);
}

/** 上方工具列的返回鍵呼叫：有畫面處理了回傳 true（工具列就不再離開頁面）。 */
export function runPageBack(): boolean {
  const order = [...handlers].sort((a, b) => b.p - a.p || b.seq - a.seq);
  return order.some((h) => h.fn());
}
