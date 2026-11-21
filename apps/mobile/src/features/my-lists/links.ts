import { Platform } from "react-native";
import { inAppBrowser } from "@/lib/in-app-browser";
import { lessonHref } from "@/lib/lesson-href";
import type { ListKind } from "./store";

/** 清單項目點下去要去哪（課程卡、教材所屬的課程頁、系列頁、中心頁）。 */
export function itemHref(it: { kind: ListKind; ref: string; ref2: string }): string {
  if (it.kind === "course") return `/course/${it.ref}`;
  if (it.kind === "lesson") return it.ref2 ? lessonHref(it.ref2, it.ref) : "/courses";
  if (it.kind === "series") return `/series/${encodeURIComponent(it.ref)}`;
  return `/courses?center=${encodeURIComponent(it.ref)}`;
}

/** 這支裝置的匿名代碼（只用來算「不重複的人數」，不含身分；網頁存在這個瀏覽器）。 */
let memVid = "";
export function visitorId(): string {
  try {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") {
      let v = localStorage.getItem("hglobal:vid");
      if (!v) {
        v = `v${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
        localStorage.setItem("hglobal:vid", v);
      }
      return v;
    }
  } catch {
    /* 沒有儲存空間就用這次開啟期間的代碼 */
  }
  return (memVid ||= `v${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`);
}

/** 點擊來源提示：App 內建瀏覽器（LINE、Facebook…）的名稱，加上上一頁網址，交給伺服器分類。 */
export function clickSource(): { hint: string; referrer: string } {
  const app = Platform.OS === "web" ? inAppBrowser() : null;
  return { hint: app?.app ?? "", referrer: Platform.OS === "web" && typeof document !== "undefined" ? document.referrer : "" };
}

export const SOURCE_LABEL: Record<string, string> = { line: "LINE", facebook: "Facebook", instagram: "Instagram", wechat: "微信", direct: "直接開啟", other: "其他網站" };
