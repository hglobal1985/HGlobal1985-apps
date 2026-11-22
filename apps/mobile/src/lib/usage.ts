import { AppState, Dimensions, Platform } from "react-native";
import { api } from "@/api/client";

/**
 * 使用統計回報（業主 2026-11-22，管理員 > 設定 > 使用統計）：匿名回報裝置（手機／平板／電腦）、系統（iOS／Android／其他）、
 * 開啟網站，以及首頁卡片被點開。不送會員編號；失敗靜默略過，不影響操作。伺服器依收到的時間記台灣時段。
 */
type Kind = "visit" | "card_course" | "card_series" | "card_center";

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

export function trackUsage(kind: Kind, target?: string) {
  try {
    void api("POST", "/usage", { kind, ...detect(), ...(target ? { target } : {}) }).catch(() => undefined);
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
