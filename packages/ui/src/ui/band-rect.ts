/**
 * 「封面區」展開時在畫面上的位置（視窗座標）：CollapseBand 量好放在這裡，CoverMiniFloat／MiniWindow 讀它，
 * 讓封面往下滑時「從原本的大小＋流光大邊框，平順縮成圓球」，動畫與影片縮成迷你播放器一致（杜杜龍 2026-11-25）。
 */
export type Rect = { x: number; y: number; w: number; h: number };
let rect: Rect | null = null;
export const setBandRect = (r: Rect | null) => {
  rect = r;
};
export const getBandRect = () => rect;
