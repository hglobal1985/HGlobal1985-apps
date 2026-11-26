import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { Icon } from "./icon";
import { space } from "@/theme/tokens";
import { AppText } from "./text";

/** 區塊（標題＋內容）。title 空白且沒有 action＝不顯示標題列（例如清單卡的教材區塊）。 */
export function Section({ title, action, children, fold = false }: { title: string; action?: ReactNode; children: ReactNode; /** true＝可收合、預設收起（設定頁的管理頁一律用這個；杜杜龍 2026-11-26）：點標題列展開。 */ fold?: boolean }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(!fold);
  if (fold) {
    return (
      <View style={styles.section}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${title}，${open ? "點一下收起" : "點一下展開"}`} onPress={() => setOpen((v) => !v)} style={[styles.head, { minHeight: 48 }]}>
          <AppText variant="title" accessibilityRole="header" style={{ flex: 1 }}>
            {title}
          </AppText>
          {action}
          <Icon name={open ? "chevron-up" : "chevron-down"} size={22} color={c.textMuted} />
        </Pressable>
        {open ? children : null}
      </View>
    );
  }
  return (
    <View style={styles.section}>
      {title || action ? (
        <View style={styles.head}>
          <AppText variant="title" accessibilityRole="header" style={{ flex: 1 }}>
            {title}
          </AppText>
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
