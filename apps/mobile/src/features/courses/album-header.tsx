import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText } from "@/ui";

const UI_ONLY = { uiOnly: true } as object;
const UI_ONLY_TEXT = { dataSet: { uiOnly: "" } } as object;

/**
 * 相簿全螢幕畫面的「返回列」共用元件（杜杜龍 2026-11-26：食譜頁的搜尋列與返回列和其他類別不一致——因為當時沒用共用元件）。
 * 相簿所有「類別／專區」畫面的固定順序：①上方工具列（資料夾清單、標題、關閉）②搜尋列（`AlbumSearchBar`）③**這一列**（圓形返回鈕＋標題＋右側說明）④內容。
 * 新增任何相簿專區畫面都用這個，不可自己拼返回列；右側的按鈕（如設定）放 `right`。
 */
export function AlbumRoundButton({ label, icon, onPress, on = false }: { label: string; icon: string; onPress: () => void; on?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.tool, on && { backgroundColor: "#2e7d32" }]}>
      <Ionicons name={icon as never} size={24} color="#fff" {...UI_ONLY} />
    </Pressable>
  );
}

export function AlbumBackHeader({ title, meta, onBack, backLabel = "回相簿首頁", right }: { title: string; meta?: string; onBack: () => void; backLabel?: string; right?: ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <AlbumRoundButton label={backLabel} icon="chevron-back" onPress={onBack} />
      <AppText numberOfLines={1} {...UI_ONLY_TEXT} style={{ flex: 1, color: "#fff", fontWeight: "900", fontSize: 18 }}>{title}</AppText>
      {meta ? <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", fontSize: 14 }}>{meta}</AppText> : null}
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  tool: { width: 50, height: 50, borderRadius: 25, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
});
