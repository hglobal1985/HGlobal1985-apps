import { useSyncExternalStore } from "react";

/**
 * 「下滑縮小」封面需要的額外捲動空間（px，杜杜龍 2026-11-24）：封面縮小時，捲動區會變高、可捲範圍反而變小，
 * 內容比較短的頁面（例如幾個區塊的品牌卡）根本捲不到封面縮完。CollapseBand 在畫面上時登記需要多少，
 * Screen 把捲動內容的最小高度撐到「捲動區高度＋這個數字」，保證一定捲得夠、封面一定縮得完（頁面底下多一小段空白）。
 */
let extra = 0;
const subs = new Set<() => void>();
export function setBandExtra(n: number) {
  const v = Math.max(0, Math.round(n));
  if (v === extra) return;
  extra = v;
  subs.forEach((f) => f());
}
export function useBandExtra(): number {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => extra,
    () => 0,
  );
}
