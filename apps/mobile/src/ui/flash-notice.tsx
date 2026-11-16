import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText } from "./text";

/**
 * 「全螢幕文字提醒」模組（業主 2026-11-16）：畫面上方浮出一張大卡片（大圖示＋大標題＋可選說明），淡入、停留、淡出，不擋操作。
 * 切換「系列／單元／教育中心」、點學習成就、點小樹苗……所有全螢幕文字提醒一律呼叫 showFlash()，
 * 想改大小、位置、動畫、停留時間，只改這個檔案，全站一起變。FlashHost 放在根版面一次。
 */
export type FlashContent = { icon?: ReactNode; title: string; body?: string; holdMs?: number };

let current: (FlashContent & { id: number }) | null = null;
const listeners = new Set<() => void>();

export function showFlash(content: FlashContent): void {
  current = { ...content, id: Date.now() + Math.random() };
  listeners.forEach((l) => l());
}

/** 所有提醒視窗固定同一個寬高（業主 2026-11-16：比原本 3 倍版再縮小 50％）；文字依字數自動換行、自動縮小；點一下立刻關閉。 */
export const FLASH_W = 190;
export const FLASH_H = 230;
/** 依字數挑字級（網頁不支援自動縮小字體，所以用字數判斷）。 */
const titleSize = (t: string) => (t.length <= 4 ? 28 : t.length <= 8 ? 22 : t.length <= 14 ? 17 : 14);
const bodySize = (t: string) => (t.length <= 12 ? 16 : t.length <= 24 ? 14 : t.length <= 40 ? 12 : 11);

function dismiss() {
  current = null;
  listeners.forEach((l) => l());
}

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
    if (!cur) {
      op.stopAnimation();
      setShown(null);
      return;
    }
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
    <View pointerEvents="box-none" style={[styles.wrap, { paddingTop: Math.round(height * 0.12) }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${shown.title}${shown.body ? `，${shown.body}` : ""}，點一下關閉`} onPress={dismiss}>
        <Animated.View style={[styles.box, { opacity: op, width: Math.min(FLASH_W, width - space.lg * 2), backgroundColor: c.surface, borderColor: c.accent }]} accessibilityLiveRegion="polite">
          {shown.icon ? <View style={styles.icon}>{shown.icon}</View> : null}
          <AppText numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6} style={[styles.title, { color: c.text, fontSize: titleSize(shown.title), lineHeight: Math.round(titleSize(shown.title) * 1.25) }]}>
            {shown.title}
          </AppText>
          {shown.body ? (
            <AppText numberOfLines={4} adjustsFontSizeToFit minimumFontScale={0.6} style={[styles.body, { color: c.textMuted, fontSize: bodySize(shown.body), lineHeight: Math.round(bodySize(shown.body) * 1.35) }]}>
              {shown.body}
            </AppText>
          ) : null}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "flex-start", zIndex: 3500 },
  box: { height: FLASH_H, paddingHorizontal: space.sm, borderRadius: radius.lg, borderWidth: 2, alignItems: "center", justifyContent: "center", gap: space.sm, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10 },
  icon: { height: 64, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "800", textAlign: "center" },
  body: { fontWeight: "600", textAlign: "center" },
});
