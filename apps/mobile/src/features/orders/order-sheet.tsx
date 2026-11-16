import { router } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import type { Order } from "@/api/client";
import { OrderCard } from "@/features/orders/order-card";
import { space } from "@/theme/tokens";
import { AppText, SheetAction } from "@/ui";
import { BottomSheet } from "@/ui/bottom-sheet";

/**
 * 報名紀錄「先看摘要、再看全部」：點一筆先從下方彈出摘要（編號、狀態、課程與金額），
 * 右上角「完整明細」膠囊進入報名明細頁（繳費、審核進度）；按住面板往上拉到最高處也會進入。
 */
export function OrderSheet({ order, onClose }: { order: Order; onClose: () => void }) {
  const go = () => {
    onClose();
    router.push(`/orders/${order.id}`);
  };
  return (
    <BottomSheet onClose={onClose} onExpand={go} expandLabel="繼續上拉進入完整明細">
      <View style={styles.head}>
        <AppText variant="headline" style={{ flex: 1 }}>
          報名摘要
        </AppText>
        <SheetAction label="完整明細" accessibilityLabel="完整明細：進入報名明細頁" onPress={go} />
      </View>
      <ScrollView style={{ maxHeight: 420 }}>
        <OrderCard order={order} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({ head: { flexDirection: "row", alignItems: "center", gap: space.md } });
