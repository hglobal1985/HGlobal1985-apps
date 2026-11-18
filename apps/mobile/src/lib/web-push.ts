import { Platform } from "react-native";
import { isIos as isIosDevice } from "./install-app";
import { api } from "@/api/client";

/**
 * 手機推播通知（網頁版，業主 2026-11-17）：開啟＝向瀏覽器要通知權限 → 註冊 /sw.js → 用伺服器的公鑰訂閱 → 把訂閱交給伺服器。
 * 之後每有一則站內通知，伺服器就推到這個裝置（關掉 App 也收得到）。
 * iPhone／iPad：要先「加入主畫面」再從主畫面開啟（iOS 16.4 以上）才能收推播；一般 Safari 分頁不行。
 */
export type PushState = "unsupported" | "ios-needs-install" | "not-ready" | "denied" | "off" | "on";

// iPad Safari 的身分會寫成 Mac 電腦，用 install-app.ts 同一個判斷（含 iPad）。
const isIos = () => isIosDevice();
const isStandalone = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
const supported = () => Platform.OS === "web" && typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const toKey = (b64: string): Uint8Array<ArrayBuffer> => {
  const t = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** 目前這個裝置的推播狀態。 */
export async function pushState(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? "ios-needs-install" : "unsupported";
  const { publicKey } = await api<{ publicKey: string | null }>("GET", "/push/key");
  if (!publicKey) return "not-ready";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    // 換帳號登入或伺服器資料被清掉時，重新交給伺服器（同一個裝置不會重複）。
    await api("POST", "/push/subscribe", sub.toJSON()).catch(() => undefined);
    return "on";
  }
  return "off";
}

/** 開啟推播；回傳開啟後的狀態。 */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? "ios-needs-install" : "unsupported";
  const { publicKey } = await api<{ publicKey: string | null }>("GET", "/push/key");
  if (!publicKey) return "not-ready";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }));
  await api("POST", "/push/subscribe", sub.toJSON());
  return "on";
}

/** 關閉這個裝置的推播。 */
export async function disablePush(): Promise<PushState> {
  if (!supported()) return "unsupported";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await api("POST", "/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe().catch(() => false);
  }
  return "off";
}
