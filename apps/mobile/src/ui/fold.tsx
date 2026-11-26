import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { Icon } from "./icon";
import { AppText } from "./text";

/**
 * 可收合區塊（業主 2026-11-26 永久指示：設定頁裡所有控制頁面的子標題列／區塊，預設全部收起，點標題列才展開細項）。
 * 設定下的各管理頁一律用它包住「有標題的區塊」：標題列整條可點（右側箭頭），預設收起；`defaultOpen` 只給特殊情況（不要隨便用）。
 * `right` 放標題列右側的小資訊（張數、狀態…，不可點）。`card`＝標題列與內容包在一張卡片裡（預設是）。
 */
export function Fold({ title, right, children, defaultOpen = false, card = true }: { title: string; right?: ReactNode; children: ReactNode; defaultOpen?: boolean; card?: boolean }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={card ? [styles.card, { backgroundColor: c.surface, borderColor: c.border }] : undefined}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${title}，${open ? "點一下收起" : "點一下展開"}`} onPress={() => setOpen((v) => !v)} style={styles.head}>
        <AppText variant="headline" style={{ flex: 1, fontWeight: "800" }}>
          {title}
        </AppText>
        {right}
        <Icon name={open ? "chevron-up" : "chevron-down"} size={20} color={c.textMuted} />
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: space.md },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 56 },
  body: { gap: space.md, paddingBottom: space.md },
});
