import { useEffect, useRef } from "react";
import { sheetPopRecent } from "./sheet-back";
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
/**
 * 開啟順序（杜杜龍 2026-11-26，食譜專區上線時補）：全螢幕視窗與上拉面板共用一個遞增編號。
 * 「上一頁」只該由最後開啟（最上層）的那一個處理：面板蓋在全螢幕視窗上時，視窗不能搶著關掉。
 */
let orderSeq = 0;
export const nextOrder = () => ++orderSeq;
const overlayOrders: number[] = [];
/** 有沒有比這個編號更晚開啟、還開著的全螢幕視窗（有的話，這個面板不是最上層，不處理上一頁）。 */
const sheetOrders: number[] = [];
export const registerSheet = (o: number) => void sheetOrders.push(o);
export const unregisterSheet = (o: number) => void (sheetOrders.includes(o) && sheetOrders.splice(sheetOrders.indexOf(o), 1));
/** 有沒有比這個全螢幕視窗更晚開啟、還開著的上拉面板（有的話「上一頁」是面板的，視窗不處理——不靠監聽器的先後順序，瀏覽器各版本順序不同）。 */
const sheetAbove = (order: number) => sheetOrders.some((o) => o > order);
export const overlayAbove = (order: number) => overlayOrders.some((o) => o > order);
/** 自己退掉多記的那筆瀏覽紀錄之前呼叫：讓其他監聽 popstate 的畫面略過這一次。 */
export const markOverlayPop = () => void (lastOverlayPop = Date.now());

export function useBackToClose(onClose: () => void, enabled = true): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!enabled || Platform.OS !== "web" || typeof window === "undefined") return;
    let popped = false;
    let wasFs = false;
    const myOrder = nextOrder();
    overlayOrders.push(myOrder);
    // 沿用目前這筆紀錄的 state（導覽套件靠 state.id 認得紀錄），只多加一個記號。
    window.history.pushState({ ...(window.history.state ?? {}), hgOverlay: 1 }, "", window.location.href);
    const onPopFirst = () => {
      if (!popped) lastOverlayPop = Date.now(); // 捕捉階段先記下，讓其他 popstate 監聽者能略過
    };
    const onPop = () => {
      if (popped || sheetPopRecent() || sheetAbove(myOrder)) return; // 上層的上拉面板處理的上一頁，不是離開這個全螢幕視窗
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
      const oi = overlayOrders.indexOf(myOrder);
      if (oi >= 0) overlayOrders.splice(oi, 1);
      // 不是用「上一頁」關的（按 X、Esc、點背景）：把多記的那一筆退掉。
      if (!popped) {
        popped = true;
        lastOverlayPop = Date.now(); // 自己退掉的那一筆也不算使用者離開頁面
        window.history.back();
      }
    };
  }, []);
}
