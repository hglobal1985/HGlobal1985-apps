import { Platform } from "react-native";

/**
 * 加到主畫面的 App（iPad／iPhone Safari 的獨立視窗）底部，網頁可用範圍常比實際螢幕矮一小塊（約 20～25），
 * 底部選單因此無法貼齊螢幕底邊（業主 2026-11-20：要像 Android 一樣上下貼齊、不浪費空間）。
 * 這裡只量出那一塊的高度（螢幕高度 − 網頁可用高度，只在獨立視窗模式、4～40；一般瀏覽器分頁、Android、電腦＝0），
 * 底部選單用「有沒有這一塊」決定要不要自己留底部安全距離：有＝那一塊本身就是安全距離（像原生 App 的小白條區），不再額外留白。
 * （2026-11-20 曾把畫面往下延伸再加留白，結果下方多空一大塊，已取消。）
 */
let gap = 0;
let listeners: Array<(g: number) => void> = [];

function standalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return !!nav.standalone || (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
}

function measure(): number {
  if (Platform.OS !== "web" || typeof window === "undefined" || !standalone()) return 0;
  const landscape = window.innerWidth > window.innerHeight;
  const [a, b] = [screen.width, screen.height];
  // iOS 的 screen.width／height 是直式固定尺寸；橫放時螢幕高度是較短的那一邊。
  const full = landscape ? Math.min(a, b) : Math.max(a, b);
  const g = full - window.innerHeight;
  return g > 4 && g <= 40 ? Math.round(g) : 0;
}

function apply(): void {
  const g = measure();
  if (g === gap) return;
  gap = g;
  listeners.forEach((l) => l(g));
}

export function installBottomGap(): () => void {
  if (Platform.OS !== "web" || typeof window === "undefined") return () => undefined;
  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  return () => {
    window.removeEventListener("resize", apply);
    window.removeEventListener("orientationchange", apply);
  };
}

export function getBottomGap(): number {
  return gap;
}

export function onBottomGap(fn: (g: number) => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}
