import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Dimensions, PixelRatio, Platform } from "react-native";
import { api } from "@/api/client";
import { currentModeKey } from "./elder-mode";

/**
 * 使用統計回報（杜杜龍 2026-11-22，管理員 > 設定 > 使用統計）：匿名回報裝置（手機／平板／電腦）、系統（iOS／Android／其他）、
 * 開啟網站，以及首頁卡片被點開。不送會員編號；失敗靜默略過，不影響操作。伺服器依收到的時間記台灣時段。
 */
type Kind = "visit" | "card_course" | "card_series" | "card_center" | "album_open" | "album_folder" | "album_photo" | "album_search" | "album_sort" | "album_info" | "album_share" | "album_download" | "album_move";

function detect(): { device: "mobile" | "tablet" | "desktop"; os: "ios" | "android" | "other" } {
  if (Platform.OS !== "web") {
    const { width, height } = Dimensions.get("window");
    return { device: Math.min(width, height) >= 600 ? "tablet" : "mobile", os: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "other" };
  }
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const ua = nav?.userAgent ?? "";
  const touch = (nav?.maxTouchPoints ?? 0) > 1;
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touch); // iPadOS 的瀏覽器自稱 Mac
  if (ipad) return { device: "tablet", os: "ios" };
  if (/iPhone|iPod/.test(ua)) return { device: "mobile", os: "ios" };
  if (/Android/.test(ua)) return { device: /Mobile/.test(ua) ? "mobile" : "tablet", os: "android" };
  return { device: "desktop", os: "other" };
}

/**
 * 裝置特徵（杜杜龍 2026-11-26「本人裝置」登記用）：螢幕短邊x長邊（CSS 像素）@像素比:系統:類型，例如 iPad Air 是 820x1180@2:ios:tablet。
 * 不含任何個人識別碼；同型號裝置會得到相同特徵。
 */
export function deviceFingerprint(): string {
  const d = detect();
  let w: number, h: number, r: number;
  if (Platform.OS === "web" && typeof screen !== "undefined") {
    w = screen.width;
    h = screen.height;
    r = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  } else {
    const s = Dimensions.get("screen");
    w = s.width;
    h = s.height;
    r = PixelRatio.get();
  }
  const a = Math.round(Math.min(w, h));
  const b = Math.round(Math.max(w, h));
  return `${a}x${b}@${Math.round(r * 100) / 100}:${d.os}:${d.device}`;
}
export const deviceLabel = (): string => {
  const d = detect();
  return `${d.os === "ios" ? "iOS" : d.os === "android" ? "Android" : "電腦"} ${d.device === "tablet" ? "平板" : d.device === "mobile" ? "手機" : "電腦"}・${deviceFingerprint().split(":")[0]}`;
};

/** 「這是杜杜龍本人的裝置」記號（杜杜龍 2026-11-23）：管理員在這個瀏覽器／手機登入過就留下，之後未登入、換測試帳號也不列入統計。 */
const OWNER_KEY = "learn.usage.owner";
let ownerDevice = false;
const ownerReady = AsyncStorage.getItem(OWNER_KEY).then((v) => void (ownerDevice = v === "1")).catch(() => undefined);

/** 管理員登入後呼叫：存裝置記號，並請伺服器記下這個網路。 */
export function markOwnerDevice() {
  ownerDevice = true;
  void AsyncStorage.setItem(OWNER_KEY, "1").catch(() => undefined);
  void api("POST", "/usage/owner").catch(() => undefined);
}

export function trackUsage(kind: Kind, target?: string) {
  try {
    void ownerReady.then(() => api("POST", "/usage", { kind, ...detect(), fp: deviceFingerprint(), mode: currentModeKey(), ...(target ? { target } : {}), ...(ownerDevice ? { owner: 1 } : {}) })).catch(() => undefined);
  } catch {
    /* 統計失敗不影響使用 */
  }
}

/** 每次開啟記一次「造訪」；放到背景超過 30 分鐘再回來也算一次。 */
export function installVisitTracking(): () => void {
  let last = Date.now();
  trackUsage("visit");
  const sub = AppState.addEventListener("change", (s) => {
    if (s !== "active") return;
    if (Date.now() - last > 30 * 60_000) trackUsage("visit");
    last = Date.now();
  });
  const away = AppState.addEventListener("change", (s) => {
    if (s !== "active") last = Math.min(last, Date.now());
  });
  return () => (sub.remove(), away.remove());
}
