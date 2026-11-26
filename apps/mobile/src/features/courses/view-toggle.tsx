import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText } from "@/ui/text";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";

export type CourseViewMode = "series" | "chapter" | "center";

/**
 * 課程清單的顯示模式切換（右邊兩顆圖示，放在分類下拉旁）：
 * ▦ 系列＝一個系列一張封面；☰ 章節＝一堂課一列；🏢 中心＝依主辦中心分類（取代舊的中心下拉）。目前的模式反白（深綠底白圖示）。
 */
/**
 * wide＝平板（直橫式）與手機橫放（杜杜龍 2026-11-18）：三顆各自獨立的按鈕＋文字，按鈕之間留間距；手機直式維持三顆圖示併成一組。
 */
export function ViewToggle({ value, onChange, wide = false }: { value: CourseViewMode; onChange: (v: CourseViewMode) => void; wide?: boolean }) {
  const { c } = useTheme();
  const item = (mode: CourseViewMode, icon: "grid-outline" | "list-outline" | "business-outline", label: string) => {
    const on = value === mode;
    if (wide)
      return (
        <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={label} onPress={() => onChange(mode)} style={[styles.wideBtn, { borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accent : c.surface }]}>
          <Ionicons name={icon} size={22} color={on ? c.textOnAccent : c.text} />
          <AppText variant="body" numberOfLines={1} style={{ color: on ? c.textOnAccent : c.text, fontWeight: "700" }}>
            {label}
          </AppText>
        </Pressable>
      );
    return (
      <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={label} onPress={() => onChange(mode)} style={[styles.btn, on && { backgroundColor: c.accent }]}>
        <Ionicons name={icon} size={22} color={on ? c.textOnAccent : c.text} />
      </Pressable>
    );
  };
  if (wide)
    return (
      <View style={styles.wideWrap} accessibilityRole="radiogroup">
        {item("series", "grid-outline", "所有系列")}
        {item("chapter", "list-outline", "單元")}
        {item("center", "business-outline", "教育中心")}
      </View>
    );
  return (
    <View style={[styles.wrap, { borderColor: c.border, backgroundColor: c.surface }]} accessibilityRole="radiogroup">
      {item("series", "grid-outline", "所有系列")}
      {item("chapter", "list-outline", "單元")}
      {item("center", "business-outline", "教育中心")}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", borderWidth: 1, borderRadius: radius.md, overflow: "hidden", height: minTouch },
  wideWrap: { flexDirection: "row", gap: space.sm },
  wideBtn: { height: minTouch, flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: 10, borderWidth: 1, borderRadius: radius.md },
  btn: { width: 44, height: "100%", alignItems: "center", justifyContent: "center" },
});
