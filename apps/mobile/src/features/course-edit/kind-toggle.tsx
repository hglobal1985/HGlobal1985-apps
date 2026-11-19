import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { minTouch } from "@/theme/tokens";
import { AppText, Icon } from "@/ui";

/**
 * 編輯面板右上角的「素材／課程」二選一（業主 2026-11-18）：系統依選擇切換整個面板的編輯模式。
 * 單選勾勾；不能選的那一邊（例如沒有權限、清單卡不能轉回課程卡）由呼叫端攔截並提示。
 */
export function KindToggle({ isList, onPick }: { isList: boolean; onPick: (toList: boolean) => void }) {
  const { c } = useTheme();
  const item = (list: boolean, label: string) => {
    const on = isList === list;
    return (
      <Pressable key={label} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={label} onPress={() => !on && onPick(list)} style={[styles.item, { backgroundColor: on ? (list ? "#FFD43B" : c.accent) : c.surface, borderColor: on ? (list ? "#FFD43B" : c.accent) : c.border }]}>
        <Icon name={on ? "checkmark-circle" : "ellipse-outline"} size={20} color={on ? (list ? "#1D2A22" : c.textOnAccent) : c.textMuted} />
        <AppText variant="callout" style={{ fontWeight: "800", color: on ? (list ? "#1D2A22" : c.textOnAccent) : c.text }}>
          {label}
        </AppText>
      </Pressable>
    );
  };
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {item(true, "清單卡")}
      {item(false, "課程卡")}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6 },
  item: { minHeight: minTouch - 4, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 4 },
});
