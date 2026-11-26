import { useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import { space } from "@/theme/tokens";
import { AppText } from "@/ui/text";
import { Button } from "@/ui/button";
import { BottomSheet } from "@/ui/bottom-sheet";

/**
 * 底部確認面板（全站統一）：需要使用者確認的動作（取消報名、刪除…）一律從螢幕下方彈出，
 * 不使用瀏覽器或系統內建的對話框。用法：`if (await confirmSheet({ title: "取消報名", message: "…", danger: true })) …`
 */
export type ConfirmOptions = {
  title: string;
  message?: string;
  /** 右邊（主要）按鈕文字，預設「確定」。 */
  confirmLabel?: string;
  /** 左邊按鈕文字，預設「取消」。 */
  cancelLabel?: string;
  /** 危險動作（刪除、取消報名）：右邊按鈕用紅色。 */
  danger?: boolean;
};
type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let current: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function confirmSheet(opts: ConfirmOptions): Promise<boolean> {
  current?.resolve(false);
  return new Promise<boolean>((done) => {
    const p: Pending = {
      ...opts,
      resolve: (ok) => {
        if (current === p) {
          current = null;
          emit();
        }
        done(ok);
      },
    };
    current = p;
    emit();
  });
}

/** 最常用的簡短寫法：標題＋說明，危險樣式（紅色確定鈕）。 */
export const confirmAsk = (title: string, message: string, confirmLabel = "確定") => confirmSheet({ title, message, confirmLabel, danger: true });

/**
 * 三選一的確認面板（杜杜龍 2026-11-26：設定頁有沒存檔的修改要離開時，主動問「儲存／放棄／繼續編輯」）。
 * 點面板外面或按「繼續編輯」＝回傳 null（留在原頁）。
 */
export type ChoiceOption = { key: string; label: string; variant: "primary" | "dangerSolid" | "cancel" | "secondary" };
type PendingChoice = { title: string; message?: string; options: ChoiceOption[]; resolve: (key: string | null) => void };
let currentChoice: PendingChoice | null = null;
export function choiceSheet(opts: { title: string; message?: string; options: ChoiceOption[] }): Promise<string | null> {
  currentChoice?.resolve(null);
  return new Promise((done) => {
    const p: PendingChoice = {
      ...opts,
      resolve: (key) => {
        if (currentChoice === p) {
          currentChoice = null;
          emit();
        }
        done(key);
      },
    };
    currentChoice = p;
    emit();
  });
}

/** 放在根版面一次即可。 */
export function ConfirmSheetHost() {
  const c = useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => currentChoice,
    () => currentChoice,
  );
  const p = useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => current,
    () => current,
  );
  if (c) {
    return (
      <BottomSheet onClose={() => c.resolve(null)}>
        <AppText variant="title">{c.title}</AppText>
        {c.message ? <AppText tone="muted">{c.message}</AppText> : null}
        <View style={{ gap: space.sm }}>
          {c.options.map((o) => (
            <Button key={o.key} variant={o.variant} label={o.label} fullWidth onPress={() => c.resolve(o.key)} />
          ))}
        </View>
      </BottomSheet>
    );
  }
  if (!p) return null;
  return (
    <BottomSheet onClose={() => p.resolve(false)}>
      <AppText variant="title">{p.title}</AppText>
      {p.message ? <AppText tone="muted">{p.message}</AppText> : null}
      <View style={styles.buttons}>
        <View style={{ flex: 1 }}>
          <Button variant={p.danger ? "secondary" : "cancel"} label={p.cancelLabel ?? "取消"} fullWidth onPress={() => p.resolve(false)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button variant={p.danger ? "dangerSolid" : "primary"} label={p.confirmLabel ?? "確定"} fullWidth onPress={() => p.resolve(true)} />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({ buttons: { flexDirection: "row", gap: space.sm } });
