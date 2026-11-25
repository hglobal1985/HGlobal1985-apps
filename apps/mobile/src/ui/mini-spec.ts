/**
 * 迷你小視窗的「規格」（業主 2026-11-24 永久指示：封面迷你小視窗必須與影片迷你小視窗一模一樣的參數與功能）。
 * 影片迷你播放器（features/player/player-layer.web.tsx）與封面迷你小視窗（ui/mini-window.tsx）都用這一份，
 * 要改位置記憶、尺寸、按鈕列、三顆按鈕的顏色，只改這個檔案，兩邊一起變。
 */
/** 小視窗位置記在本機的鍵（影片與封面共用同一個位置：搬到哪裡，另一個也出現在哪裡）。 */
export const MINI_POS_KEY = "hglobal:learn:mini-pos";
/** 小視窗離螢幕邊緣的最小距離。 */
export const MINI_MARGIN = 8;
/** 縮小後的小圓圖直徑。 */
export const MINI_CIRCLE = 84;
/** 小視窗上方的視窗按鈕列高度（最小化／最大化／關閉放在播放外框上方，位置仿 Windows、顏色仿 Mac）。 */
export const MINI_BAR = 34;
/** 小視窗寬度（16:9，高度＝寬度 × 9 ÷ 16）：視窗寬度的 55%，但最少 180、最多 240。 */
export const miniFloatWidth = (winW: number) => Math.round(Math.min(240, Math.max(180, winW * 0.55)));
/** 按鈕列：實心深色底、左右 10px、按鈕間距 12px、上面兩個圓角 12px。 */
export const MINI_BAR_BG = "rgba(24,24,24,0.88)";
/** 三顆圓形按鈕：直徑 26px（手指好按），顏色仿 Mac（黃＝最小化、綠＝最大化、紅＝關閉），符號顏色。 */
export const MINI_BTN = 26;
export const MINI_BTN_COLORS = { min: "#FEBC2E", max: "#28C840", close: "#FF5F57" } as const;
export const MINI_BTN_GLYPH_COLOR = "rgba(0,0,0,0.65)";
export const MINI_GLYPHS = { min: "─", max: "□", close: "✕" } as const;
/** 三顆按鈕永遠顯示（業主 2026-11-25，取消原本 1 秒自動隱藏）。 */
/** 小視窗邊框圓角（流光邊框 GradientFrame 的 radius）。 */
export const MINI_RADIUS = 14;
