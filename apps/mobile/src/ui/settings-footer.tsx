import { StyleSheet, View } from "react-native";
import { space } from "@/theme/tokens";
import { Button } from "./button";

/**
 * 設定頁統一的存檔列（業主 2026-11-26 永久指示：設定下所有頁面，一頁只有一個存檔鈕、固定在同一個位置，不分區塊各自存檔）。
 * 一律放在 `Screen` 的 `footer`：左邊「還原」（紅框取消樣式）、右邊「儲存」（深綠）；沒有修改時兩顆都灰掉但位置不變。
 * 搭配 `useUnsavedPrompt`（lib/settings-page.tsx）：有未存的修改要離開頁面時，會主動問「儲存／放棄修改／繼續編輯」。
 */
export function SettingsFooter({ dirty, saving = false, onSave, onDiscard }: { dirty: boolean; saving?: boolean; onSave: () => void; onDiscard: () => void }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Button variant="cancel" label="還原" icon="refresh-outline" onPress={onDiscard} disabled={!dirty || saving} fullWidth />
      </View>
      <View style={{ flex: 1 }}>
        <Button label="儲存" icon="save-outline" onPress={onSave} loading={saving} disabled={!dirty || saving} fullWidth />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row", gap: space.sm } });
