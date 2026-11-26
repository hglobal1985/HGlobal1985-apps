import { Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/theme/theme";
import { minTouch, space } from "@/theme/tokens";
import { AppText } from "./text";

/**
 * 上拉選單右上角的「進入完整內容」按鈕（杜杜龍 2026-11-16 指示：全站一律用這個膠囊樣式）：
 * 深綠膠囊、白色粗體字（例如「顯示全部」「完整介紹」）。搭配 BottomSheet 的 onExpand：往上拉到最高處也會進入同一個地方。
 */
export function SheetAction({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel?: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} style={[styles.btn, { backgroundColor: c.accent }]}>
      <AppText variant="callout" style={{ color: c.textOnAccent, fontWeight: "800" }} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { minHeight: minTouch, paddingHorizontal: space.lg, borderRadius: 999, alignItems: "center", justifyContent: "center", flexShrink: 0 },
});
