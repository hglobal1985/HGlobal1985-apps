import { ScrollView, StyleSheet, View } from "react-native";
import type { Notice } from "@/api/client";
import { dateTime } from "@/features/format";
import { space } from "@/theme/tokens";
import { AppText, SheetAction } from "@/ui";
import { BottomSheet } from "@/ui/bottom-sheet";
import { afterSheetClose } from "@/lib/sheet-back";

/**
 * 通知「先看摘要、再看全部」：點一則通知先從下方彈出完整內容（標題、全文、時間），
 * 右上角「前往查看」膠囊（有連結的通知才有）進入對應頁面；按住面板往上拉到最高處也會進入（BottomSheet onExpand）。
 */
export function NoticeSheet({ notice, onClose, onOpen }: { notice: Notice; onClose: () => void; /** 前往這則通知對應的頁面（沒有連結就不傳）。 */ onOpen?: () => void }) {
  const go = () => {
    onClose();
    afterSheetClose(() => onOpen?.());
  };
  return (
    <BottomSheet onClose={onClose} onExpand={onOpen ? go : undefined} expandLabel="繼續上拉前往查看">
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <AppText variant="headline">{notice.title}</AppText>
          <AppText variant="caption" tone="muted">
            {dateTime(notice.createdAt)}
          </AppText>
        </View>
        {onOpen ? <SheetAction label="前往查看" accessibilityLabel="前往查看這則通知的內容" onPress={go} /> : null}
      </View>
      <ScrollView style={{ maxHeight: 360 }}>
        <AppText variant="body" selectable>
          {notice.body || "（沒有內文）"}
        </AppText>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({ head: { flexDirection: "row", alignItems: "flex-start", gap: space.md } });
