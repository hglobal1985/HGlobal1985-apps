import { useState } from "react";
import type { Order } from "@/api/client";
import { OrderSheet } from "@/features/orders/order-sheet";
import { OrderCard } from "@/features/orders/order-card";
import { WebOnly } from "@/features/web-only";
import { useApi } from "@/state/session";
import { EmptyState, ErrorView, LoadingView, Screen } from "@/ui";

function Orders() {
  const { data, error, loading, reload } = useApi<Order[]>("/orders");
  const [preview, setPreview] = useState<Order | null>(null);
  return (
    <Screen header={false}>
      {loading && !data ? <LoadingView /> : null}
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {data && !data.length ? <EmptyState icon="receipt-outline" title="還沒有報名紀錄" /> : null}
      {data?.map((o) => <OrderCard key={o.id} order={o} onPress={() => setPreview(o)} />)}
      {preview ? <OrderSheet order={preview} onClose={() => setPreview(null)} /> : null}
    </Screen>
  );
}

export default function OrdersScreen() {
  return (
    <WebOnly>
      <Orders />
    </WebOnly>
  );
}
