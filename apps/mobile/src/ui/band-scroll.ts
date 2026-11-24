import { resetPlayerShrink, scrollPlayerPageTop, usePlayerScrollPx } from "@/features/player/shrink";

/**
 * 頁面捲動位移（像素），給「下滑縮小」模組（ui/collapse-band.tsx）用（App 版：讀 Screen 的 Scroller 回報的位置）。
 * 網頁版在 band-scroll.web.ts 自己聽頁面主要的捲動區。
 */
export const useBandScroll = usePlayerScrollPx;
export const resetBandScroll = resetPlayerShrink;
/** 回到頁面頂端（迷你封面按一下）。 */
export const scrollBandTop = scrollPlayerPageTop;
