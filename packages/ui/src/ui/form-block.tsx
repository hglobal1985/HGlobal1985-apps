import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText } from "./text";
import { CollapseToggle } from "./collapse-toggle";

/**
 * 表單區塊（杜杜龍 2026-11-18：所有區塊的標題要明顯區隔）：淡綠標題列（左邊一條深綠粗線）＋框起來的內容。
 * 編輯面板裡「分類、品牌、系列、建立單位…」每一組都用它，標題一眼可辨。
 */
export function FormBlock({ title, hint, children, collapsible }: { title: string; hint?: string; children: ReactNode; /** 有傳＝預設收起，標題右側有展開／收起鈕（杜杜龍 2026-11-19）。 */ collapsible?: boolean }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(!collapsible);
  return (
    <View style={[styles.box, { borderColor: c.border, backgroundColor: c.surface }]}>
      <View style={[styles.head, { backgroundColor: c.accentSoft }]}>
        <View style={[styles.bar, { backgroundColor: c.accent }]} />
        <AppText variant="headline" accessibilityRole="header" style={{ color: c.accentText, fontWeight: "800", flex: 1 }}>
          {title}
        </AppText>
        {collapsible ? <CollapseToggle open={open} onPress={() => setOpen((v) => !v)} label={title} /> : null}
      </View>
      {open ? <View style={styles.body}>
        {hint ? (
          <AppText variant="caption" tone="muted">
            {hint}
          </AppText>
        ) : null}
        {children}
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.md, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingRight: space.md, minHeight: 40 },
  bar: { width: 6, alignSelf: "stretch" },
  body: { padding: space.md, gap: space.sm },
});
