import { View } from "react-native";
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

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="暫時無法載入"
      body={message}
      action={onRetry ? <Button variant="secondary" label="重新整理" icon="refresh" onPress={onRetry} /> : undefined}
    />
  );
}
