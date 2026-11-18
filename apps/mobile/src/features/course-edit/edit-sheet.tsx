import Ionicons from "@expo/vector-icons/Ionicons";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { confirmSheet } from "@/features/confirm";
import { space } from "@/theme/tokens";
import { AppText, Button, NoticeBox } from "@/ui";
import { BottomSheet } from "@/ui/bottom-sheet";

/** 面板裡的內容（例如封面上傳）自己有「儲存」時，登記到面板下方那一列（業主 2026-11-17：儲存與關閉永遠同一列）。 */
export type SheetSave = { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; dirty?: boolean };
const SaveSlot = createContext<((s: SheetSave | null) => void) | null>(null);
/** 在 EditSheet 裡面登記儲存鈕（傳 null＝沒有）；回傳 true＝真的在面板裡（呼叫端就不要再自己畫儲存鈕）。 */
export function useSheetSave(spec: SheetSave | null): boolean {
  const set = useContext(SaveSlot);
  const press = useRef(spec?.onPress);
  press.current = spec?.onPress;
  const on = !!spec;
  useEffect(() => {
    if (!set) return;
    set(on ? { label: spec!.label, busy: spec!.busy, disabled: spec!.disabled, dirty: spec!.dirty, onPress: () => press.current?.() } : null);
    return () => set(null);
  }, [set, on, spec?.label, spec?.busy, spec?.disabled, spec?.dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  return !!set;
}

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
  material = false,
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
  /** 素材（清單類別）：標題列右上角顯示黃色「素材」標示，方便跟課程區分（業主 2026-11-18）。 */
  material?: boolean;
  children: ReactNode;
}) {
  const { height } = useWindowDimensions();
  const [slot, setSlot] = useState<SheetSave | null>(null);
  const isBusy = busy || !!slot?.busy;
  const isDirty = dirty || !!slot?.dirty;
  const close = async () => {
    if (isBusy) return;
    if (isDirty && !(await confirmSheet({ title: "還沒儲存", message: "剛才的修改還沒儲存，要放棄修改嗎？", cancelLabel: "繼續編輯", confirmLabel: "放棄", danger: true }))) return;
    onClose();
  };
  return (
    <BottomSheet onClose={close}>
      <SaveSlot.Provider value={setSlot}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.titleRow}>
          <AppText variant="title" accessibilityRole="header" style={{ flex: 1 }}>
            {title}
          </AppText>
          {material ? (
            <View style={styles.matTag} accessibilityLabel="素材">
              <Ionicons name="folder-open" size={14} color="#1D2A22" />
              <AppText variant="caption" style={{ color: "#1D2A22", fontWeight: "800" }}>
                素材
              </AppText>
            </View>
          ) : null}
        </View>
        <ScrollView style={{ maxHeight: height * 0.68 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {error ? <NoticeBox tone="danger" text={error} /> : null}
        <View style={styles.buttons}>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" label={hideSave && !slot ? "關閉" : "取消"} fullWidth disabled={isBusy} onPress={close} />
          </View>
          {!hideSave && onSave ? (
            <View style={{ flex: 1 }}>
              <Button label={saveLabel} icon="save-outline" fullWidth loading={busy} disabled={busy} onPress={onSave} />
            </View>
          ) : slot ? (
            <View style={{ flex: 1 }}>
              <Button label={slot.label} icon="save-outline" fullWidth loading={!!slot.busy} disabled={!!slot.busy || !!slot.disabled} onPress={slot.onPress} />
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
      </SaveSlot.Provider>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  matTag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "#FFD43B" },
  body: { gap: space.md, paddingVertical: space.md },
  buttons: { flexDirection: "row", gap: space.sm, paddingTop: space.sm },
});
