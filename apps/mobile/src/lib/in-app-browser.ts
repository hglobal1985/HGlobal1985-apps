import { Platform } from "react-native";

/**
 * App 內建瀏覽器（業主 2026-11-17 統一稱呼）：LINE、Facebook、Instagram、微信…點連結時在自己視窗裡開的網頁，功能常被限制
 * （例如不准程式代按播放）。對照：手機自己的 Chrome、Safari 叫「系統瀏覽器」。
 * 偵測靠瀏覽器識別字串；要新增 App 只改下面 APPS 清單一處。
 */
const APPS: { name: string; test: RegExp }[] = [
  { name: "LINE", test: /\bLine\//i },
  { name: "Instagram", test: /Instagram/i },
  { name: "Messenger", test: /Messenger|Orca-Android/i },
  { name: "Facebook", test: /FBAN|FBAV|FB_IAB|FBIOS/i },
  { name: "微信", test: /MicroMessenger/i },
  { name: "TikTok", test: /musical_ly|TikTok|Bytedance/i },
  { name: "KakaoTalk", test: /KAKAOTALK/i },
  { name: "Snapchat", test: /Snapchat/i },
];

export type InAppInfo = { app: string; /** 按鈕上寫的系統瀏覽器：iPhone＝Safari，其餘＝Chrome（Android 看不出使用者實際的預設瀏覽器）。 */ browser: "Safari" | "Chrome"; ios: boolean };

let cached: InAppInfo | null | undefined;
/** 目前是否在 App 內建瀏覽器裡；不是（或不是網頁版）回 null。 */
export function inAppBrowser(): InAppInfo | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== "web" || typeof navigator === "undefined") return (cached = null);
  const ua = navigator.userAgent;
  const hit = APPS.find((a) => a.test.test(ua));
  const ios = /iPad|iPhone|iPod/.test(ua);
  return (cached = hit ? { app: hit.name, browser: ios ? "Safari" : "Chrome", ios } : null);
}

/**
 * 請系統瀏覽器開啟目前這一頁。LINE 認得網址參數 openExternalBrowser=1；Android 其他 App 用 Chrome 的 intent 網址；
 * iPhone 其他 App 試 x-safari-https，不行就複製網址（回傳 "copied" 讓畫面提示「請貼到 Safari」）。
 */
export function openInSystemBrowser(info: InAppInfo): "copied" | undefined {
  const u = new URL(window.location.href);
  if (info.app === "LINE") {
    u.searchParams.set("openExternalBrowser", "1");
    window.location.href = u.toString();
    return undefined;
  }
  if (!info.ios) {
    window.location.href = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(u.toString())};end`;
    return undefined;
  }
  window.location.href = `x-safari-${u.toString()}`;
  void navigator.clipboard?.writeText(u.toString()).catch(() => undefined);
  return "copied";
}
