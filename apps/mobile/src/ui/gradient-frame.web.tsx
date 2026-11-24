import type { CSSProperties, ReactNode } from "react";
import { useTheme } from "@/theme/theme";

/**
 * 「流光漸層邊框」模組（業主 2026-11-17）：迷你播放器那圈網站色系（深綠、橄欖、金）的高級反光漸層邊框，緩慢流動；
 * 全螢幕文字提醒（flash-notice）與迷你播放器（player-layer.web）共用這一組定義，以後要改粗細、顏色、動畫、陰影，只改這個檔案，兩邊一起變，
 * 之後新增任何要用這種邊框的地方也用 GradientFrame（或 frameBoxStyle），不要另寫。iOS／Android 在 gradient-frame.tsx（先用單色邊框）。
 */
/** 漸層顏色（網站色系）。 */
export const FRAME_GRADIENT = "linear-gradient(135deg,#0c603c 0%,#cee49f 16%,#fff3c4 28%,#f2c063 40%,#486c48 56%,#0c603c 70%,#cee49f 84%,#0c603c 100%)";
/** 邊框粗細（px）。 */
export const FRAME_PAD = 4.5;
/** 外圍陰影與細亮邊。 */
export const FRAME_SHADOW = "0 6px 24px rgba(12,96,60,0.45), 0 0 0 1px rgba(255,243,196,0.35)";
/** 流動動畫（7 秒一輪）。 */
export const FRAME_ANIMATION = "hg-sheen 7s linear infinite";
/** 動畫的 CSS（放進任何一個 <style>；GradientFrame 自己已經帶了）。 */
export const FRAME_KEYFRAMES = "@keyframes hg-sheen{0%{background-position:0% 50%}100%{background-position:300% 50%}}";

/** 套在「邊框那一層」元素上的樣式（背景漸層＋陰影＋流動）。on＝false 時回到純黑無邊框。 */
export function frameBoxStyle(on: boolean): CSSProperties {
  return {
    background: on ? FRAME_GRADIENT : "#000",
    backgroundSize: on ? "300% 300%" : "auto",
    boxShadow: on ? FRAME_SHADOW : "none",
    animation: on ? FRAME_ANIMATION : "none",
  };
}

/**
 * 邊框元件：外面是流光漸層邊框，裡面放內容（內容底色用主題的表面色）。
 * width／height／radius 決定外框大小與圓角；running＝false 時流光暫停。
 */
export function GradientFrame({ width, height, radius = 20, running = true, flush = false, children }: { width: number | string; height: number | string; radius?: number; running?: boolean; /** true＝內容鋪滿邊框裡面（沒有左右留白、不置中；迷你小視窗用）。 */ flush?: boolean; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <div style={{ width, height, boxSizing: "border-box", padding: FRAME_PAD, borderRadius: radius, display: "flex", ...frameBoxStyle(true), animationPlayState: running ? "running" : "paused" }}>
      <style>{FRAME_KEYFRAMES}</style>
      <div style={{ flex: 1, minWidth: 0, borderRadius: Math.max(0, radius - FRAME_PAD), background: c.surface, overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: flush ? 0 : "0 8px" }}>{children}</div>
    </div>
  );
}
