import { Platform } from "react-native";

/**
 * 平板（iPad、Android 平板）網頁版整體放大（業主 2026-11-18：大螢幕不可直接套用手機的 UI 尺寸）。
 *
 * 做法：用瀏覽器原生的 viewport 設定把「每個 CSS 像素」放大（例如 iPad Air 直式 820 寬 → 版面寬 683、所有東西放大 1.2 倍），
 * 字級、按鈕、圖示、間距、上拉面板、播放控制列……全站每一個元件一起等比放大，手勢座標與量測也都自動一致（不是 CSS zoom，不會有座標錯位）。
 * 版面「怎麼排」（幾欄、內容多寬、課程頁左右兩欄）另由 theme/layout.ts 依放大後的寬度決定。
 *
 * 只對「觸控平板」生效：螢幕短邊 ≥ 600（手機橫放不算）。電腦瀏覽器本來就不理會 viewport 設定，電腦版靠 theme/layout.ts 的寬版排版。
 * 要調放大倍數只改下面兩個數字。
 */
export const TABLET_SCALE_PORTRAIT = 1.2;
export const TABLET_SCALE_LANDSCAPE = 1.12;
/** 螢幕短邊至少這麼寬才算平板（iPad mini 744、iPad Air 820；手機最寬約 440）。 */
const TABLET_MIN_SHORT = 600;

const base = "viewport-fit=cover";
const plain = `width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, ${base}`;

let loadWidth = 0; // 網頁剛開啟時（viewport 還是 1 倍）量到的真實寬度：iPad 分割畫面時比螢幕窄
let loadLandscape = false;
let scaledNow = false; // 每次套用 viewport 時記下，給全站文字元件快速查詢（不用每次重算）

function isTouchTablet(): boolean {
  if (typeof window === "undefined" || typeof screen === "undefined") return false;
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || "ontouchstart" in window;
  return touch && Math.min(screen.width, screen.height) >= TABLET_MIN_SHORT;
}

function landscapeNow(): boolean {
  const o = (screen as Screen & { orientation?: { type?: string } }).orientation?.type;
  if (o) return o.startsWith("landscape");
  const w = (window as unknown as { orientation?: number }).orientation;
  if (typeof w === "number") return Math.abs(w) === 90;
  return window.innerWidth > window.innerHeight;
}

/** 目前方向下，平板視窗在 1 倍時的寬度（CSS 像素）。 */
function idealWidth(landscape: boolean): number {
  const short = Math.min(screen.width, screen.height);
  const long = Math.max(screen.width, screen.height);
  const full = landscape ? long : short;
  // 跟剛開啟時同方向：用當時實際量到的寬度（分割畫面、側拉視窗比整個螢幕窄）。
  return loadWidth && landscape === loadLandscape ? Math.min(full, loadWidth) : full;
}

/** 這台裝置現在該用的 viewport 設定（也給 no-page-zoom.ts 用，兩邊不會互相蓋掉）。 */
export function viewportContent(): string {
  return plain; // 2026-11-18 起不再用 viewport 放大（iPad Safari 不一定理會、還會連圖片放大）；改由 theme/ui-scale.ts 放大字體、圖示與按鈕。
  // eslint-disable-next-line no-unreachable
  if (Platform.OS !== "web" || typeof window === "undefined" || !isTouchTablet()) return plain;
  const landscape = landscapeNow();
  const ideal = idealWidth(landscape);
  if (ideal < TABLET_MIN_SHORT) return plain; // 分割畫面窄到像手機：維持 1 倍
  const s = landscape ? TABLET_SCALE_LANDSCAPE : TABLET_SCALE_PORTRAIT;
  const w = Math.round(ideal / s);
  return `width=${w}, initial-scale=${s}, minimum-scale=${s}, maximum-scale=${s}, user-scalable=no, ${base}`;
}

function apply() {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "viewport";
    document.head.appendChild(meta);
  }
  const next = viewportContent();
  scaledNow = next !== plain;
  if (meta.content !== next) meta.content = next;
}

// 載入時立刻套用（在根版面最早 import），轉向時重新計算。
if (Platform.OS === "web" && typeof window !== "undefined" && typeof document !== "undefined") {
  loadWidth = window.innerWidth;
  loadLandscape = landscapeNow();
  apply();
  const later = () => {
    apply();
    setTimeout(apply, 250); // iOS 轉向後尺寸要稍等才穩定
  };
  window.addEventListener("orientationchange", later);
  (screen as Screen & { orientation?: EventTarget }).orientation?.addEventListener?.("change", later);
}

/** 目前是否正以「平板放大」顯示（給 theme/layout.ts 判斷：平板已整體放大，文字不要再放大一次）。 */
export function tabletScaled(): boolean {
  return scaledNow;
}

export const applyViewport = () => {
  if (Platform.OS === "web" && typeof document !== "undefined") apply();
};
