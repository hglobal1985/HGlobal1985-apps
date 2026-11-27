import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText } from "@/ui";

/**
 * 上傳／轉存進度條（杜杜龍 2026-11-18）：pct 0～100；pct＝null 代表大小未知（例如 Google 文件轉檔），顯示來回跑的進度條。
 * 上傳教材檔案、從 Google 雲端硬碟匯入共用。
 */
export function UploadProgress({ label, pct, detail }: { label: string; pct: number | null; detail?: string }) {
  const { c } = useTheme();
  const run = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (pct !== null) return;
    const loop = Animated.loop(Animated.timing(run, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [pct, run]);
  return (
    <View style={{ gap: space.xs }} accessibilityRole="progressbar" accessibilityValue={pct === null ? undefined : { min: 0, max: 100, now: pct }}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <View style={{ height: 12, borderRadius: radius.pill, backgroundColor: c.surfaceMuted, overflow: "hidden" }}>
        {pct === null ? (
          <Animated.View style={{ position: "absolute", top: 0, bottom: 0, width: "35%", borderRadius: radius.pill, backgroundColor: c.accent, left: run.interpolate({ inputRange: [0, 1], outputRange: ["-35%", "100%"] }) }} />
        ) : (
          <View style={{ height: "100%", width: `${Math.max(2, pct)}%`, borderRadius: radius.pill, backgroundColor: c.accent }} />
        )}
      </View>
      <AppText variant="caption" style={{ fontWeight: "700" }}>
        {pct === null ? detail ?? "處理中…" : `${pct}%${detail ? `・${detail}` : ""}`}
      </AppText>
    </View>
  );
}
