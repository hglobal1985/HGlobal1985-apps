import { useEffect, useRef } from "react";
import { Platform } from "react-native";

/**
 * 全螢幕視窗的「返回」處理（業主 2026-11-24，網頁版）：視窗開著時多記一筆瀏覽紀錄，
 * 按瀏覽器／手機的「上一頁」＝直接關閉視窗、回到下面的畫面（不會只是先退出瀏覽器全螢幕、圖片視窗還留著）。
 * 另外，瀏覽器全螢幕被退出（返回鍵、Esc）時也一併關閉視窗。用 X 關閉時會把多記的那一筆紀錄退掉，不留下多餘的上一頁。
 * 全站要做「全螢幕蓋住畫面」的視窗，一律用這個。
 */
let lastOverlayPop = 0;
/** 剛剛是不是「上一頁」關掉了全螢幕視窗（其他監聽 popstate 的畫面要略過這一次，不然會以為使用者離開了那一頁）。 */
export const overlayPopRecent = () => Date.now() - lastOverlayPop < 500;

export function useBackToClose(onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    let popped = false;
    let wasFs = false;
    // 沿用目前這筆紀錄的 state（導覽套件靠 state.id 認得紀錄），只多加一個記號。
    window.history.pushState({ ...(window.history.state ?? {}), hgOverlay: 1 }, "", window.location.href);
    const onPopFirst = () => {
      if (!popped) lastOverlayPop = Date.now(); // 捕捉階段先記下，讓其他 popstate 監聽者能略過
    };
    const onPop = () => {
      if (popped) return;
      popped = true;
      close.current();
    };
    const onFs = () => {
      if (document.fullscreenElement) wasFs = true;
      else if (wasFs && !popped) close.current();
    };
    window.addEventListener("popstate", onPopFirst, true);
    window.addEventListener("popstate", onPop);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("popstate", onPopFirst, true);
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("fullscreenchange", onFs);
      // 不是用「上一頁」關的（按 X、Esc、點背景）：把多記的那一筆退掉。
      if (!popped) {
        popped = true;
        lastOverlayPop = Date.now(); // 自己退掉的那一筆也不算使用者離開頁面
        window.history.back();
      }
    };
  }, []);
}
