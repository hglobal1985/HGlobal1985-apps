import { useEffect, type MutableRefObject } from "react";
import { Platform } from "react-native";
import { markOverlayPop, overlayPopRecent } from "./back-close";

/**
 * 所有上拉面板（`BottomSheet`）的「瀏覽器上一頁／手機返回手勢」處理（杜杜龍 2026-11-26 永久指示：
 * 有類似「有東西沒存、不要讓使用者誤離開」需求的功能，瀏覽器上一頁與手勢一律也要攔下）。
 * 面板開著時多記一筆同網址的瀏覽紀錄：按「上一頁」只會退掉這一筆（畫面不離開），並呼叫面板的 onClose——
 * 有未儲存內容的面板（EditSheet）自己會跳出「放棄／繼續編輯」；一般選單就直接關閉。
 * 面板仍開著（例如選了「繼續編輯」）就把那一筆補回去。多層面板用堆疊，一次只有最上層的面板反應。
 */
const stack: number[] = [];
let seq = 0;
let lastSheetPop = 0;
let selfPopUntil = 0;
/** 剛剛是不是面板處理的「上一頁」或面板自己退掉紀錄（其他監聽 popstate 的全螢幕視窗要略過這一次）。 */
export const sheetPopRecent = () => Date.now() - lastSheetPop < 120 || Date.now() < selfPopUntil;

export function useSheetBack(close: MutableRefObject<() => unknown>): void {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const id = ++seq;
    stack.push(id);
    let popped = false;
    let alive = true;
    const push = () => window.history.pushState({ ...(window.history.state ?? {}), hgSheet: id }, "", window.location.href);
    push();
    const onCapture = () => {
      if (stack[stack.length - 1] === id && !popped && Date.now() >= selfPopUntil && !overlayPopRecent()) lastSheetPop = Date.now();
    };
    const onPop = () => {
      if (!alive || popped || stack[stack.length - 1] !== id || Date.now() < selfPopUntil || overlayPopRecent()) return;
      popped = true;
      void Promise.resolve()
        .then(() => close.current())
        .catch(() => undefined)
        .then(() =>
          setTimeout(() => {
            if (!alive) return;
            popped = false; // 面板還開著（繼續編輯）：補回那一筆
            push();
          }, 160),
        );
    };
    window.addEventListener("popstate", onCapture, true);
    window.addEventListener("popstate", onPop);
    return () => {
      alive = false;
      window.removeEventListener("popstate", onCapture, true);
      window.removeEventListener("popstate", onPop);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      if (!popped) {
        // 不是用「上一頁」關的（按取消、點背景…）：把多記的那一筆退掉，別讓其他面板、全螢幕視窗誤以為使用者離開頁面。
        selfPopUntil = Date.now() + 400;
        markOverlayPop();
        window.history.back();
      }
    };
  }, []);
}
