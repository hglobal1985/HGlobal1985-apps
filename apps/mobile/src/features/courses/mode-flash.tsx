import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText } from "@/ui";
import type { CourseViewMode } from "./view-toggle";

/** 兩種顯示模式的正式名稱（業主 2026-11-15）。 */
export const MODE_NAME: Record<CourseViewMode, string> = { series: "課程／活動／場次", chapter: "主題／單元／各棒次", center: "中心" };

/** 切換模式時，畫面正中間短暫浮出目前模式的名稱（約 1.2 秒淡出，不擋操作）。tick 每切換一次加 1。 */
export function ModeFlash({ mode, tick }: { mode: CourseViewMode; tick: number }) {
  const { c } = useTheme();
  const op = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!tick) return;
    op.stopAnimation();
    op.setValue(0);
    const run = Animated.sequence([Animated.timing(op, { toValue: 1, duration: 140, useNativeDriver: true }), Animated.delay(800), Animated.timing(op, { toValue: 0, duration: 320, useNativeDriver: true })]);
    run.start();
    return () => run.stop();
  }, [tick, op]);
  if (!tick) return null;
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View style={[styles.box, { opacity: op, backgroundColor: c.surface, borderColor: c.accent }]} accessibilityLiveRegion="polite">
        <Ionicons name={mode === "series" ? "grid-outline" : mode === "chapter" ? "list-outline" : "business-outline"} size={40} color={c.accent} />
        <AppText variant="headline" style={{ textAlign: "center" }}>
          {MODE_NAME[mode]}
        </AppText>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  box: { maxWidth: 280, paddingHorizontal: space.xl, paddingVertical: space.lg, borderRadius: radius.lg, borderWidth: 1.5, alignItems: "center", gap: space.sm, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
});
