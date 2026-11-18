import { Pressable } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius } from "@/theme/tokens";
import { Icon } from "./icon";
import { AppText } from "./text";

/**
 * 展開／收起按鈕（業主 2026-11-18：編輯模式的「設定」與各區塊預設收起，按鈕放標題右側；全站編輯模式一致）。
 * 深綠膠囊：收起時顯示「展開 ⌄」，展開時顯示「收起 ⌃」。
 */
export function CollapseToggle({ open, onPress, label }: { open: boolean; onPress: () => void; label: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${open ? "收起" : "展開"}${label}`} onPress={onPress} hitSlop={6} style={({ pressed }) => [{ minHeight: 36, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: c.accent }, pressed && { opacity: 0.8 }]}>
      <AppText variant="callout" style={{ color: c.textOnAccent, fontWeight: "800" }}>
        {open ? "收起" : "展開"}
      </AppText>
      <Icon name={open ? "chevron-up" : "chevron-down"} size={16} color={c.textOnAccent} />
    </Pressable>
  );
}
