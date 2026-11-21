// 點底部選單「課程」＝一律回到寰宇大學「所有系列」檢視（業主 2026-11-21）：按鈕呼叫 requestCoursesReset()，
// 寰宇大學畫面（CoursesView）訂閱後把自己的狀態全部還原；畫面還沒建立時（從課程內頁等回來）由 consumeCoursesReset 補做。
type Fn = () => void;
const subs = new Set<Fn>();
let pending = false;
export function requestCoursesReset() {
  pending = true;
  subs.forEach((f) => f());
}
export function onCoursesReset(f: Fn) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}
/** 畫面剛建立時呼叫：有還沒處理的要求就回傳 true 並清掉。 */
export function consumeCoursesReset() {
  const p = pending;
  pending = false;
  return p;
}
export function clearCoursesReset() {
  pending = false;
}
