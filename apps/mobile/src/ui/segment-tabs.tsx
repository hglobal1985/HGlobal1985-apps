import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius } from "@/theme/tokens";
import { AppText } from "./text";

/**
 * 兩段（或多段）切換鈕（業主 2026-11-21 統一：中心頁「課程｜清單」、系列頁與課程頁「詳細列表｜縮圖」都用這一款）：
 * 全寬、淡灰底軌道、目前選的是深綠實心白字。要改外觀只改這個檔案；新增任何全寬的分類切換一律用它。
 */
export function SegmentTabs<T extends string>({ options, value, onChange }: { options: { key: T; label: string }[]; value: T; onChange: (key: T) => void }) {
  const { c } = useTheme();
  return (
    <View style={[styles.seg, { backgroundColor: c.surfaceMuted }]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={o.label} onPress={() => onChange(o.key)} style={[styles.btn, on ? { backgroundColor: c.accent } : null]}>
            <AppText variant="callout" style={{ fontWeight: "800", color: on ? c.textOnAccent : c.text }}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  seg: { flexDirection: "row", borderRadius: radius.md, padding: 3, alignSelf: "stretch" },
  btn: { flex: 1, minHeight: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
});
