import { router } from "expo-router";
import type { ComponentProps } from "react";
import { Button } from "./button";
import { useSession } from "@/state/session";
import { EmptyState } from "./empty-state";
import { LoadingView } from "./state-views";

/**
 * 「尚未登入」提示卡（杜杜龍 2026-11-17：全站統一用「學習中」那一款）：圓形圖示＋「尚未登入」＋說明＋「前往登入」。
 * 學習中、通知、成就、設定（登入頁）都用它；要改版面或按鈕文字只改這個檔案。
 * 登入狀態還在確認時（重新整理頁面的瞬間）改顯示讀取動畫，不閃一下「尚未登入」誤導人（杜杜龍 2026-11-24）。
 * onLogin 不傳＝前往設定頁登入；設定頁本身傳「直接開始 Google 登入」。
 */
export function GuestGate({ body, icon = "person-circle-outline", onLogin, loading }: { body: string; icon?: ComponentProps<typeof EmptyState>["icon"]; onLogin?: () => void; loading?: boolean }) {
  const { ready } = useSession();
  if (!ready) return <LoadingView />;
  return <EmptyState icon={icon} title="尚未登入" body={body} action={<Button label="前往登入" loading={loading} onPress={onLogin ?? (() => router.navigate("/me"))} />} />;
}
