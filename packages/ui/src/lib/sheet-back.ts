import { useEffect, type MutableRefObject } from "react";
import { Platform } from "react-native";
import { markOverlayPop, nextOrder, overlayAbove, registerSheet, unregisterSheet } from "./back-close";

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

/**
 * 「關閉面板、然後前往別頁」要用這個包住前往的動作（杜杜龍 2026-11-26 回報：面板右上角「完整清單」等按鈕全部沒反應）。
 * 原因：面板關閉時會把多記的那一筆瀏覽紀錄用 history.back() 退掉（非同步），
 * 若同一時間已經 router.push 到新頁，這個 back 會把剛開啟的新頁又退回去，看起來就是按鈕沒反應。
 * 這裡讓前往動作等面板的紀錄退掉之後才執行；沒有面板開著（或不是網頁）就立刻執行。
 */
let pendingNav: (() => void)[] = [];
const flushNav = () => {
  const list = pendingNav;
  pendingNav = [];
  list.forEach((fn) => fn());
};
export function afterSheetClose(go: () => void): void {
  if (Platform.OS !== "web" || typeof window === "undefined" || stack.length === 0) return go();
  pendingNav.push(go);
  // 保險：面板一直沒關（或事件沒來）就不要卡住，稍後照常前往。
  setTimeout(() => {
    const i = pendingNav.indexOf(go);
    if (i >= 0) {
      pendingNav.splice(i, 1);
      go();
    }
  }, 700);
}

export function useSheetBack(close: MutableRefObject<() => unknown>): void {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const id = ++seq;
    const order = nextOrder();
    registerSheet(order);
    stack.push(id);
    let popped = false;
    let alive = true;
    const push = () => window.history.pushState({ ...(window.history.state ?? {}), hgSheet: id }, "", window.location.href);
    push();
    const onCapture = () => {
      if (stack[stack.length - 1] === id && !popped && Date.now() >= selfPopUntil && !overlayAbove(order)) lastSheetPop = Date.now();
    };
    const onPop = () => {
      if (!alive || popped || stack[stack.length - 1] !== id || Date.now() < selfPopUntil || overlayAbove(order)) return;
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
      unregisterSheet(order);
      if (!popped) {
        // 不是用「上一頁」關的（按取消、點背景…）：把多記的那一筆退掉，別讓其他面板、全螢幕視窗誤以為使用者離開頁面。
        selfPopUntil = Date.now() + 400;
        markOverlayPop();
        if (pendingNav.length) {
          // 有人在等「面板關好才前往別頁」：等這一筆退掉（popstate）之後才放行。
          const run = () => {
            window.removeEventListener("popstate", run);
            clearTimeout(t);
            if (stack.length === 0) flushNav();
          };
          const t = setTimeout(run, 250);
          window.addEventListener("popstate", run);
        }
        window.history.back();
      } else setTimeout(() => stack.length === 0 && flushNav(), 0);
    };
  }, []);
}
