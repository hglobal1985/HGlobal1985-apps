import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { confirmSheet } from "@/features/confirm";
import { space } from "@/theme/tokens";
import { AppText, Button, NoticeBox } from "@/ui";
import { BottomSheet } from "@/ui/bottom-sheet";

/**
 * 課程頁「原地編輯」用的底部面板：上方標題、中間可捲動的欄位、下方固定兩顆按鈕（左「取消」、右「儲存」）。
 * 改到一半要關掉：先從下方彈出確認「還沒儲存，要放棄修改嗎？」（左「繼續編輯」、右「放棄」）。
 * 鍵盤彈出時內容會往上推，輸入框不會被鍵盤遮住。
 */
export function EditSheet({
  title,
  onClose,
  onSave,
  dirty = false,
  busy = false,
  error,
  saveLabel = "儲存",
  hideSave = false,
  children,
}: {
  title: string;
  onClose: () => void;
  onSave?: () => void;
  dirty?: boolean;
  busy?: boolean;
  error?: string | null;
  saveLabel?: string;
  /** 只有「關閉」（例如章節面板裡各自有儲存鈕、或只是查看）。 */
  hideSave?: boolean;
  children: ReactNode;
}) {
  const { height } = useWindowDimensions();
  const close = async () => {
    if (busy) return;
    if (dirty && !(await confirmSheet({ title: "還沒儲存", message: "剛才的修改還沒儲存，要放棄修改嗎？", cancelLabel: "繼續編輯", confirmLabel: "放棄", danger: true }))) return;
    onClose();
  };
  return (
    <BottomSheet onClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <AppText variant="title" accessibilityRole="header">
          {title}
        </AppText>
        <ScrollView style={{ maxHeight: height * 0.68 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {error ? <NoticeBox tone="danger" text={error} /> : null}
        <View style={styles.buttons}>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" label={hideSave ? "關閉" : "取消"} fullWidth disabled={busy} onPress={close} />
          </View>
          {!hideSave && onSave ? (
            <View style={{ flex: 1 }}>
              <Button label={saveLabel} icon="save-outline" fullWidth loading={busy} disabled={busy} onPress={onSave} />
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md, paddingVertical: space.md },
  buttons: { flexDirection: "row", gap: space.sm, paddingTop: space.sm },
});
