import { View } from "react-native";
import { UPGRADING_MSG } from "@/api/client";
import { LoadingSapling } from "./loading-sapling";
import { Button } from "./button";
import { EmptyState } from "./empty-state";

export function LoadingView() {
  return (
    <View style={{ alignItems: "center" }}>
      <LoadingSapling />
    </View>
  );
}

/**
 * 整頁「暫時無法載入」（業主 2026-11-24）：說明文字一律是「網站功能正在升級中、請稍候再試」。
 * 只有「找不到」「沒有權限」這種有明確原因的白話訊息照常顯示；登入失效（請先登入…）通常是部署更新期間連線被重置，也用同一句。
 */
const isAuthMessage = (m: string) => /請先登入|登入已過期|重新登入|unauthenticated|reauth/i.test(m);
export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const body = !message || isAuthMessage(message) ? UPGRADING_MSG : message;
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="暫時無法載入"
      body={body}
      action={onRetry ? <Button variant="secondary" label="重新整理" icon="refresh" onPress={onRetry} /> : undefined}
    />
  );
}
