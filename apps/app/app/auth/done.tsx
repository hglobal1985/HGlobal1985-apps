import { Redirect } from "expo-router";
/** 中央登入回傳頁（處理在 session.tsx）；處理完導回原本的頁面。 */
export default function AuthDone() {
  return <Redirect href="/" />;
}
