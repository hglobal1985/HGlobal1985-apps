import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Animated, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { createPortal } from "react-dom";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { dimStyle, hasDimLayer } from "./dim-backdrop";
import { GradientFrame } from "./gradient-frame";
import { AppText } from "./text";

/**
 * 「全螢幕文字提醒」模組（杜杜龍 2026-11-16）：畫面上方浮出一張大卡片（大圖示＋大標題＋可選說明），淡入、停留、淡出，不擋操作。
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

/**
 * 一句話的操作回饋（原本底部黑色小字 toast 的替代品，杜杜龍 2026-11-17：全站統一用全螢幕提醒）：
 * 例如 flashText("已複製連結")。依文字自動挑圖示（失敗＝紅色驚嘆號、提醒＝資訊圖示、其他＝綠色勾勾）；
 * 太長的句子在第一個標點切成「標題＋說明」。新增任何一句話提示都用它，不要再做底部小字。
 */
export function flashText(text: string): void {
  // 冒號後面緊接數字（例如時間 7:00）不是分隔點，不能把時間切成兩半（杜杜龍 2026-11-22 回報「從上次看到的 7」「00 繼續播放」）。
  const m = /^(.{2,14}?)(?:[，,。；;：]|:(?!\d))\s*(.+)$/.exec(text);
  const title = m && text.length > 12 ? m[1]! : text;
  const body = m && text.length > 12 ? m[2] : undefined;
  const bad = /無法|失敗|錯誤|不能|不正確|過期|已存在|不足|逾時/.test(text);
  const hint = /^請|繼續播放|若沒有/.test(text);
  const icon = bad ? (
    <Ionicons name="alert-circle" size={FLASH_ICON - 3} color="#B3261E" />
  ) : hint ? (
    <Ionicons name="information-circle" size={FLASH_ICON - 3} color="#0C603C" />
  ) : (
    <Ionicons name="checkmark-circle" size={FLASH_ICON - 3} color="#0C603C" />
  );
  showFlash({ icon, title, body, holdMs: text.length > 14 ? 1600 : 1000 });
}

/**
 * 所有提醒視窗固定同一個寬高（杜杜龍 2026-11-16：比原本 3 倍版再縮小 50％；之後再把整體縮成 80%：寬度不變、高度 230→184，圖示與文字一起縮成 80%）；
 * 文字依字數自動換行、自動縮小；點一下立刻關閉。
 */
export const FLASH_W = 190;
export const FLASH_H = 184;
/** 圖示區高度（原本 64 的 80%）；呼叫端的圖示請用 FLASH_ICON 當尺寸。 */
export const FLASH_ICON = 51;
/** 依字數挑字級（網頁不支援自動縮小字體，所以用字數判斷）；都是原本的 80%。 */
const titleSize = (t: string) => (t.length <= 4 ? 22 : t.length <= 8 ? 18 : t.length <= 14 ? 14 : 11);
const bodySize = (t: string) => (t.length <= 12 ? 13 : t.length <= 24 ? 11 : t.length <= 40 ? 10 : 9);

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
  const [dim, setDim] = useState(true); // 已有彈出層開著時，不再多疊一層暗化
  useEffect(() => {
    if (!cur) {
      op.stopAnimation();
      setShown(null);
      return;
    }
    setShown(cur);
    setDim(!hasDimLayer());
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
  // 網頁：用 portal 放到最上層（上拉面板、照片放大等彈出層開著時，提醒也要看得到、不被蓋住）。
  const web = Platform.OS === "web" && typeof document !== "undefined";
  const node = (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingTop: Math.round(height * 0.12) }, web && ({ position: "fixed", zIndex: 20000 } as object)]}>
      {/* 提醒出現時整個頁面背景暗化（杜杜龍 2026-11-17）；跟著卡片一起淡入淡出，不擋住下面的操作。 */}
      {dim ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, dimStyle, { opacity: op }]} /> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`${shown.title}${shown.body ? `，${shown.body}` : ""}，點一下關閉`} onPress={dismiss}>
        <Animated.View style={{ opacity: op }} accessibilityLiveRegion="polite">
          {/* 邊框＝迷你播放器同款流光漸層邊框（共用模組 ui/gradient-frame，杜杜龍 2026-11-17） */}
          <GradientFrame width={Math.min(FLASH_W, width - space.lg * 2)} height={FLASH_H} radius={radius.lg}>
          {shown.icon ? <View style={styles.icon}>{shown.icon}</View> : null}
          <AppText numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6} style={[styles.title, { color: c.text, fontSize: titleSize(shown.title), lineHeight: Math.round(titleSize(shown.title) * 1.25) }]}>
            {shown.title}
          </AppText>
          {shown.body ? (
            <AppText numberOfLines={4} adjustsFontSizeToFit minimumFontScale={0.6} style={[styles.body, { color: c.textMuted, fontSize: bodySize(shown.body), lineHeight: Math.round(bodySize(shown.body) * 1.35) }]}>
              {shown.body}
            </AppText>
          ) : null}
          </GradientFrame>
        </Animated.View>
      </Pressable>
    </View>
  );
  return web ? createPortal(node, document.body) : node;
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "flex-start", zIndex: 3500 },
  box: { height: FLASH_H, paddingHorizontal: space.sm, borderRadius: radius.lg, borderWidth: 2, alignItems: "center", justifyContent: "center", gap: space.sm, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10 },
  icon: { height: FLASH_ICON, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "800", textAlign: "center" },
  body: { fontWeight: "600", textAlign: "center" },
});
