import { useSyncExternalStore } from "react";
import { useWindowDimensions } from "react-native";
import { usePlayer } from "./use-player";

/**
 * App 版「往下滑影片縮成迷你播放器」的共用進度（杜杜龍 2026-11-24；網頁版在 player-layer.web.tsx 自己處理）。
 * 頁面往下滑 SHRINK_PX 像素＝進度 1（完全縮成迷你）；PlayerSlot（舞台縮矮）與 PlayerLayer（浮動小視窗）都讀這一份。
 */
export const SHRINK_PX = 140;
let p = 0;
let py = 0; // 捲動位移（像素），封面縮小模組（ui/collapse-band）用
let scrollTop: (() => void) | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** 頁面主要捲動區回報捲動位置；top＝回到最上方的方法（迷你播放器按「最大化」用）。 */
export function reportPlayerScroll(y: number, top?: () => void) {
  if (top) scrollTop = top;
  const n = Math.min(1, Math.max(0, y / SHRINK_PX));
  const ny = Math.max(0, Math.round(y));
  if (n === p && ny === py) return;
  p = n;
  py = ny;
  emit();
}
export function resetPlayerShrink() {
  if (p === 0 && py === 0) return;
  p = 0;
  py = 0;
  emit();
}
/** 頁面捲動位移（像素，App 版）。 */
export function usePlayerScrollPx(): number {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => py,
    () => 0,
  );
}
export const scrollPlayerPageTop = () => scrollTop?.();

/** 目前的縮小進度（0～1）；手機橫放且暫停時（空間不夠）直接＝1。 */
export function useShrink(): number {
  const v = useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => p,
    () => 0,
  );
  const { width, height } = useWindowDimensions();
  const s = usePlayer();
  return width > height && height < 520 && !s.playing ? 1 : v;
}
