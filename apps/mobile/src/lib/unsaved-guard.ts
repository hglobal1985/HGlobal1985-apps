/**
 * 尚未儲存的離開攔截（業主 2026-11-24，至尊模式的會員資料表單）：表單有改動還沒儲存時，登記一個「攔截函式」；
 * 底部選單、頁面上的跳轉按鈕與返回，離開之前都先問它。它回傳 false＝攔下來（畫面捲到儲存鈕、顯示「尚未儲存」與「放棄」鈕），
 * 使用者按「放棄」才會執行原本要做的動作。沒有登記（表單沒改動）就直接放行。
 */
type Guard = (proceed: () => void) => boolean;
let guard: Guard | null = null;

export const setUnsavedGuard = (g: Guard | null) => {
  guard = g;
};
/** 要離開目前畫面之前呼叫：沒有未儲存的改動就立刻執行 action；有就攔下並交給表單處理。 */
export function runGuarded(action: () => void): void {
  if (guard && !guard(action)) return;
  action();
}
export const hasUnsaved = () => guard !== null;
