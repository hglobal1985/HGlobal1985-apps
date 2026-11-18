import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { inAppBrowser } from "./in-app-browser";

/**
 * 「加入主畫面」（業主 2026-11-18）：安裝成 App 後，手機推播的來源會顯示「寰宇行動大學」而不是網址，也開啟得更快。
 * Android Chrome 會送出 beforeinstallprompt，我們存起來，按鈕一按就跳出系統的安裝視窗；iPhone Safari 沒有這個事件，只能教使用者用「分享 → 加入主畫面」。
 * 這個檔案要在根版面最早 import（事件只會送一次）。
 */
type Deferred = { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: Deferred | null = null;
let installed = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

if (Platform.OS === "web" && typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as unknown as Deferred;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    emit();
  });
}

export const isStandalone = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
export const isIos = () => typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** 這個瀏覽器能不能（也值得）請使用者加入主畫面：手機網頁、還沒安裝、不是 App 內建瀏覽器（那裡裝不了，另有紅色警示條）。 */
export function canSuggestInstall(): boolean {
  return Platform.OS === "web" && isMobile() && !isStandalone() && !installed && !inAppBrowser();
}

/** Android：跳出系統安裝視窗；回傳 true＝使用者同意。沒有事件（iPhone 等）回傳 null，呼叫端改顯示教學。 */
export async function installNative(): Promise<boolean | null> {
  if (!deferred) return null;
  const d = deferred;
  deferred = null;
  await d.prompt();
  const r = await d.userChoice;
  emit();
  return r.outcome === "accepted";
}

export function useInstallState(): { suggest: boolean; native: boolean } {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return { suggest: canSuggestInstall(), native: !!deferred };
}
