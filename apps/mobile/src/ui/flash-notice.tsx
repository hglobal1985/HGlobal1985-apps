import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Animated, StyleSheet, useWindowDimensions, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText } from "./text";

/**
 * 「全螢幕文字提醒」模組（業主 2026-11-16）：畫面上方浮出一張大卡片（大圖示＋大標題＋可選說明），淡入、停留、淡出，不擋操作。
 * 切換「相同系列／單元／寰宇教育中心」、點學習成就、點小樹苗……所有全螢幕文字提醒一律呼叫 showFlash()，
 * 想改大小、位置、動畫、停留時間，只改這個檔案，全站一起變。FlashHost 放在根版面一次。
 */
export type FlashContent = { icon?: ReactNode; title: string; body?: string; holdMs?: number };

let current: (FlashContent & { id: number }) | null = null;
const listeners = new Set<() => void>();

export function showFlash(content: FlashContent): void {
  current = { ...content, id: Date.now() + Math.random() };
  listeners.forEach((l) => l());
}

/** 目前的尺寸＝原本的 3 倍（圖示 40→120、標題 17→52、說明 13→39）；卡片寬度不超過螢幕，位置靠上。 */
export const FLASH_SCALE = 3;

export function FlashHost() {
  const { c } = useTheme();
  const { width, height } = useWindowDimensions();
  const cur = useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => current,
    () => current,
  );
  const op = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState<typeof current>(null);
  useEffect(() => {
    if (!cur) return;
    setShown(cur);
    op.stopAnimation();
    op.setValue(0);
    const run = Animated.sequence([
      Animated.timing(op, { toValue: 1, duration: 140, useNativeDriver: true }),
      Animated.delay(cur.holdMs ?? 900),
      Animated.timing(op, { toValue: 0, duration: 320, useNativeDriver: true }),
    ]);
    run.start(({ finished }) => finished && setShown(null));
    return () => run.stop();
  }, [cur, op]);
  if (!shown) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { paddingTop: Math.round(height * 0.12) }]}>
      <Animated.View
        style={[styles.box, { opacity: op, maxWidth: width - space.lg * 2, backgroundColor: c.surface, borderColor: c.accent }]}
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${shown.title}${shown.body ? `，${shown.body}` : ""}`}
      >
        {shown.icon ? <View style={styles.icon}>{shown.icon}</View> : null}
        <AppText style={[styles.title, { color: c.text }]}>{shown.title}</AppText>
        {shown.body ? <AppText style={[styles.body, { color: c.textMuted }]}>{shown.body}</AppText> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "flex-start", zIndex: 3500 },
  box: { paddingHorizontal: space.sm, paddingVertical: space.lg * FLASH_SCALE, borderRadius: radius.lg * 2, borderWidth: 3, alignItems: "center", gap: space.sm * FLASH_SCALE, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  icon: { minHeight: 40 * FLASH_SCALE, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17 * FLASH_SCALE, lineHeight: 22 * FLASH_SCALE, fontWeight: "800", textAlign: "center" },
  body: { fontSize: 13 * FLASH_SCALE, lineHeight: 18 * FLASH_SCALE, fontWeight: "600", textAlign: "center" },
});
