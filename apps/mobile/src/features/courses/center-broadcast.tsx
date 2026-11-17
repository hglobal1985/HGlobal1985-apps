import { trackFeature } from "@/lib/feature-track";
import { useEffect, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, View } from "react-native";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Button, Icon } from "@/ui";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";

export type Broadcasts = { seconds: number; items: { id: string; text: string; date: string }[] };

/** 中心的廣播公告資料（公開）。 */
export function useCenterBroadcasts(center: string) {
  return useApi<Broadcasts>(center ? `/center-broadcasts?center=${encodeURIComponent(center)}` : null);
}

/**
 * 中心頁地址下方的「廣播公告」黃色橫條（業主 2026-11-17）：強制只顯示一行，太長就「… 更多」；
 * 依設定的秒數（預設 2 秒）自動輪播；手指上下左右滑動可切換；點一下彈出完整公告清單（日期＋內容）。顏色用網站標準亮黃色（同「已付費」標籤）。
 */
export function CenterBroadcastBand({ items, seconds, onOpen }: { items: Broadcasts["items"]; seconds: number; onOpen: () => void }) {
  const { scheme } = useTheme();
  const [i, setI] = useState(0);
  const touching = useRef(false);
  const fade = useRef(new Animated.Value(1)).current;
  const n = items.length;
  const go = (d: number) => {
    if (n < 2) return;
    Animated.timing(fade, { toValue: 0, duration: 110, useNativeDriver: true }).start(() => {
      setI((x) => (x + d + n) % n);
      Animated.timing(fade, { toValue: 1, duration: 140, useNativeDriver: true }).start();
    });
  };
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (n < 2) return;
    const t = setInterval(() => !touching.current && goRef.current(1), Math.max(1, seconds) * 1000);
    return () => clearInterval(t);
  }, [n, seconds]);
  useEffect(() => {
    if (i >= n) setI(0);
  }, [n, i]);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 10 || Math.abs(g.dy) > 10,
      onPanResponderGrant: () => void (touching.current = true),
      onPanResponderRelease: (_e, g) => {
        touching.current = false;
        const horizontal = Math.abs(g.dx) >= Math.abs(g.dy);
        const d = horizontal ? g.dx : g.dy;
        if (Math.abs(d) > 24) goRef.current(d < 0 ? 1 : -1); // 往左／往上＝下一則；往右／往下＝上一則
      },
      onPanResponderTerminate: () => void (touching.current = false),
    }),
  ).current;
  if (!n) return null;
  const bg = scheme === "dark" ? "#F5C518" : "#FFD43B";
  const fg = scheme === "dark" ? "#2A1D00" : "#5A3B00";
  const cur = items[Math.min(i, n - 1)]!;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`廣播公告：${cur.text}，點一下看全部`} onPress={onOpen} style={[styles.band, { backgroundColor: bg }]} {...pan.panHandlers} data-no-pull-refresh="">
      <Icon name="megaphone" size={20} color={fg} />
      <Animated.View style={[styles.textWrap, { opacity: fade }]}>
        <AppText variant="callout" numberOfLines={1} ellipsizeMode="tail" style={{ color: fg, fontWeight: "700", flexShrink: 1 }}>
          {cur.text}
        </AppText>
      </Animated.View>
      <AppText variant="callout" style={{ color: fg, fontWeight: "800" }}>
        更多
      </AppText>
      {n > 1 ? (
        <AppText variant="caption" style={{ color: fg, fontWeight: "700" }}>
          {Math.min(i, n - 1) + 1}/{n}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/** 全部公告：日期＋內容（用統一的上拉面板，高度依內容自動調整）。 */
export function BroadcastSheet({ title, items, onClose }: { title: string; items: Broadcasts["items"]; onClose: () => void }) {
  const { c } = useTheme();
  useEffect(() => trackFeature("broadcast_open"), []);
  return (
    <BottomSheet onClose={onClose}>
      <AppText variant="headline">{title}</AppText>
      <SheetScroll>
        {items.map((x) => (
          <View key={x.id} style={[styles.row, { borderTopColor: c.border }]}>
            <AppText variant="callout" tone="muted" style={{ fontWeight: "700" }}>
              {x.date}
            </AppText>
            <AppText variant="body">{x.text}</AppText>
          </View>
        ))}
      </SheetScroll>
      <Button variant="secondary" label="關閉" onPress={onClose} fullWidth />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  band: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouch, paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.md },
  textWrap: { flex: 1, minWidth: 0 },
  row: { gap: 4, paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
