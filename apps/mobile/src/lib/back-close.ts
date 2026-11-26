import { useEffect, useRef } from "react";
import { Platform } from "react-native";

/**
 * 全螢幕視窗的「返回」處理（杜杜龍 2026-11-24，網頁版）：視窗開著時多記一筆瀏覽紀錄，
 * 按瀏覽器／手機的「上一頁」＝直接關閉視窗、回到下面的畫面（不會只是先退出瀏覽器全螢幕、圖片視窗還留著）。
 * 另外，瀏覽器全螢幕被退出（返回鍵、Esc）時也一併關閉視窗。用 X 關閉時會把多記的那一筆紀錄退掉，不留下多餘的上一頁。
 * 全站要做「全螢幕蓋住畫面」的視窗，一律用這個。
 */
let lastOverlayPop = 0;
/** 剛剛是不是「上一頁」關掉了全螢幕視窗（其他監聽 popstate 的畫面要略過這一次，不然會以為使用者離開了那一頁）。 */
/**
 * 檔案選擇視窗開著時，瀏覽器會自己收起全螢幕——這不是使用者要關閉視窗（杜杜龍 2026-11-25 回報：全螢幕相簿按「上傳照片」選好檔案，視窗整個消失、沒有上傳）。
 * 上傳按鈕在開檔案選擇視窗前呼叫 holdFullscreenClose()，選好或取消後呼叫 releaseFullscreenClose()（再多留 1.5 秒緩衝），期間全螢幕被收起不關閉視窗。
 */
let holdUntil = 0;
export const holdFullscreenClose = (ms = 120_000) => void (holdUntil = Date.now() + ms);
export const releaseFullscreenClose = () => void (holdUntil = Date.now() + 1500);
export const overlayPopRecent = () => Date.now() - lastOverlayPop < 500;
/** 自己退掉多記的那筆瀏覽紀錄之前呼叫：讓其他監聽 popstate 的畫面略過這一次。 */
export const markOverlayPop = () => void (lastOverlayPop = Date.now());

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
      else if (wasFs && !popped && Date.now() > holdUntil) close.current();
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
