import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText } from "./text";

/**
 * 表單區塊（業主 2026-11-18：所有區塊的標題要明顯區隔）：淡綠標題列（左邊一條深綠粗線）＋框起來的內容。
 * 編輯面板裡「分類、品牌、系列、建立單位…」每一組都用它，標題一眼可辨。
 */
export function FormBlock({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={[styles.box, { borderColor: c.border, backgroundColor: c.surface }]}>
      <View style={[styles.head, { backgroundColor: c.accentSoft }]}>
        <View style={[styles.bar, { backgroundColor: c.accent }]} />
        <AppText variant="headline" accessibilityRole="header" style={{ color: c.accentText, fontWeight: "800", flex: 1 }}>
          {title}
        </AppText>
      </View>
      <View style={styles.body}>
        {hint ? (
          <AppText variant="caption" tone="muted">
            {hint}
          </AppText>
        ) : null}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.md, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingRight: space.md, minHeight: 40 },
  bar: { width: 6, alignSelf: "stretch" },
  body: { padding: space.md, gap: space.sm },
});
