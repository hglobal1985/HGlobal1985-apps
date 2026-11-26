import { useSyncExternalStore } from "react";

/**
 * 「只在迷你播放器／小圓圖播放」（杜杜龍 2026-11-25）：影片正以迷你播放器或小圓圖浮在畫面上時，使用者在課程頁點了別的影片，
 * 新的這支直接在目前的迷你播放器／小圓圖裡播，課程頁不長出整頁的大播放器。使用者按迷你播放器的「最大化」才回到整頁播放。
 */
let on = false;
const subs = new Set<() => void>();
export function setStayMini(v: boolean) {
  if (on === v) return;
  on = v;
  subs.forEach((f) => f());
}
export const useStayMini = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => on,
    () => false,
  );
