import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { space } from "@/theme/tokens";
import { AppText } from "./text";

/** 區塊（標題＋內容）。title 空白且沒有 action＝不顯示標題列（例如清單卡的教材區塊）。 */
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
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
