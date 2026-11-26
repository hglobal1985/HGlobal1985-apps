import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { inAppBrowser } from "./in-app-browser";

/**
 * 「加入主畫面」（杜杜龍 2026-11-18）：安裝成 App 後，手機推播的來源會顯示「寰宇行動大學」而不是網址，也開啟得更快。
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
  // 這支手機已經把本站安裝成 App（例如從超派模式裝過）：Chrome 不會再送安裝許可事件，所以先問瀏覽器，已安裝就不再顯示安裝邀請（杜杜龍 2026-11-24 回報按了沒反應）。
  (navigator as unknown as { getInstalledRelatedApps?: () => Promise<unknown[]> }).getInstalledRelatedApps?.()
    .then((apps) => {
      if (apps.length) {
        installed = true;
        emit();
      }
    })
    .catch(() => undefined);
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    emit();
  });
}

export const isStandalone = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
/**
 * iPad 的 Safari 預設「以電腦版網站瀏覽」，瀏覽器身分會寫成 Mac 電腦（Macintosh），只能從「有觸控螢幕」分辨出是 iPad（杜杜龍 2026-11-18：iPad 也要顯示安裝提醒）。
 */
export const isIpad = () =>
  typeof navigator !== "undefined" && (/iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints ?? 0) > 1));
export const isIos = () => typeof navigator !== "undefined" && (/iPhone|iPod/.test(navigator.userAgent) || isIpad());
/** 手機或平板（Android 手機與平板、iPhone、iPad）；一般電腦不算。 */
const isMobile = () => typeof navigator !== "undefined" && (/Android|iPhone|iPod/i.test(navigator.userAgent) || isIpad());

/** 這個瀏覽器能不能（也值得）請使用者加入主畫面：手機或平板網頁（含 iPad）、還沒安裝、不是 App 內建瀏覽器（那裡裝不了，另有紅色警示條）。 */
export function canSuggestInstall(): boolean {
  return Platform.OS === "web" && isMobile() && !isStandalone() && !installed && !inAppBrowser();
}

/** Android：跳出系統安裝視窗；回傳 true＝使用者同意。沒有事件（iPhone 等）回傳 null，呼叫端改顯示教學。 */
export async function installNative(): Promise<boolean | null> {
  // Android 的安裝許可事件有時要等幾秒才送來（杜杜龍 2026-11-24：至尊頁按了卻變成要手動操作）：還沒收到就先等最多 3 秒，收到就直接跳出系統安裝視窗。
  if (!deferred && !isIos() && isMobile()) {
    await new Promise<void>((resolve) => {
      const done = () => {
        subs.delete(done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 3000);
      subs.add(done);
    });
  }
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

/** 這次沒等到系統安裝視窗：Android 多半是「已經裝過了」，呼叫端要提醒從桌面開啟。 */
export const likelyInstalledAndroid = () => !isIos() && isMobile();
