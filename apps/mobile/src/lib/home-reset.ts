// 已經在「首頁」時再按一次底部選單的首頁＝清掉首頁的狀態、回到預設值（業主 2026-11-25）：
// 按鈕呼叫 requestHomeReset()，首頁畫面（至尊的搜尋首頁）用 onHomeReset 訂閱後自行清空搜尋字、停止語音。
type Fn = () => void;
const subs = new Set<Fn>();
export const requestHomeReset = () => subs.forEach((f) => f());
export function onHomeReset(f: Fn) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}
