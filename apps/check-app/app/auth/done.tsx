import { Redirect } from "expo-router";
import { useSession } from "@/state/session";

/** 中央登入回傳頁（處理在 state/session.tsx）；處理完導回原本要去的頁面。 */
export default function AuthDone() {
  const { returnTo } = useSession();
  return <Redirect href={(returnTo && !returnTo.startsWith("/auth/") ? returnTo : "/") as never} />;
}
