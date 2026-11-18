import { useRef, useState, type ReactNode } from "react";
import { Animated, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/theme";
import { useLayout } from "@/theme/layout";
import { radius, space } from "@/theme/tokens";
import { dimStyle, useDimLayer } from "./dim-backdrop";
import { AppText } from "./text";

/** 網頁：手指按的位置在「已經往下捲過的清單」裡時，不攔截手勢（讓清單自己捲動，不會誤收起面板）。 */
function inScrolledList(target: unknown): boolean {
  if (Platform.OS !== "web" || typeof document === "undefined") return false;
  for (let n = target as Element | null; n && n !== document.body; n = n.parentElement) {
    const st = getComputedStyle(n);
    if ((st.overflowY === "auto" || st.overflowY === "scroll") && n.scrollHeight > n.clientHeight && n.scrollTop > 0) return true;
  }
  return false;
}

/** 網頁：手指往上拉時，如果按的位置在「還能往下捲的清單」裡，就不攔截（讓清單自己捲）；清單已捲到底或沒有清單才攔截。 */
function inUnfinishedList(target: unknown): boolean {
  if (Platform.OS !== "web" || typeof document === "undefined") return false;
  for (let n = target as Element | null; n && n !== document.body; n = n.parentElement) {
    const st = getComputedStyle(n);
    if ((st.overflowY === "auto" || st.overflowY === "scroll") && n.scrollHeight > n.clientHeight && n.scrollTop + n.clientHeight < n.scrollHeight - 2) return true;
  }
  return false;
}

/**
 * 底部彈出面板的外框（從螢幕下方向上滑出、背後半透明、點外面等於取消）。
 * 「確認視窗」「改播詢問」等所有從下方彈出的面板都用它，樣式與手勢只在這裡改一次。
 *
 * 內建手勢（業主 2026-11-15 永久指示，所有上拉式選單一律有）：在面板或背景上往下滑，面板跟著手指移動；
 * 放開時滑過一小段就順勢滑出畫面並關閉（等同按取消），沒滑夠就彈回原位。
 * swipeUpClose＝連往上滑一小段也算關閉（分類篩選用：滑動等於確定套用）。
 * onExpand＝「上拉進入完整內容」（業主 2026-11-16）：按住面板任何位置往上拉，面板跟著手指長高；拉過約一半距離放開、或一路拉到最高處，
 * 就直接進入右上角那個按鈕對應的內頁（呼叫 onExpand）；沒拉夠就彈回。expandLabel＝上拉時顯示的提示文字。右上角按鈕請用 SheetAction。
 * 新增任何上拉式選單都必須用這個元件，不要自己用 Modal 重做。
 */
export function BottomSheet({ onClose, children, swipeUpClose = false, onExpand, expandLabel }: { onClose: () => void; children: ReactNode; swipeUpClose?: boolean; onExpand?: () => void; expandLabel?: string }) {
  const { c } = useTheme();
  useDimLayer();
  const insets = useSafeAreaInsets();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const upRef = useRef(swipeUpClose);
  upRef.current = swipeUpClose;
  const expandRef = useRef(onExpand);
  expandRef.current = onExpand;
  const { height: winH } = useWindowDimensions();
  // 大螢幕（平板、電腦）：面板不再整片滿版，置中、限制寬度（theme/layout.ts 的 sheetMax，業主 2026-11-18）。
  const { sheetMax } = useLayout();
  const [sheetH, setSheetH] = useState(0);
  // 上拉最多拉到「面板頂端接近螢幕上緣」。
  const maxUp = useRef(300);
  maxUp.current = Math.max(120, winH - sheetH - insets.top - 24);
  const ty = useRef(new Animated.Value(0)).current;
  const native = Platform.OS !== "web";
  const back = () => Animated.spring(ty, { toValue: 0, useNativeDriver: native }).start();
  const expandFn = useRef(onExpand);
  expandFn.current = onExpand;
  const expanding = useRef(false);
  const finishExpand = () => expandFn.current?.();
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (e, g) =>
        Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2 && !(g.dy > 0 && inScrolledList(e.target)) && !(g.dy < 0 && (!expandRef.current || inUnfinishedList(e.target))),
      onPanResponderMove: (_e, g) => {
        if (expanding.current) return;
        if (g.dy > 0) ty.setValue(g.dy);
        else if (expandRef.current) {
          // 上拉：跟著手指走，超過最高處就變很難拉（橡皮筋）；一路拉到最高處就直接進入。
          const max = maxUp.current;
          const up = -g.dy;
          ty.setValue(-(up <= max ? up : max + (up - max) * 0.2));
          if (up >= max) {
            expanding.current = true; // 只觸發一次
            Animated.timing(ty, { toValue: -max, duration: 80, useNativeDriver: native }).start(() => finishExpand());
          }
        }
      },
      onPanResponderRelease: (_e, g) => {
        if (expanding.current) return;
        if (g.dy > 70 || (g.dy > 25 && g.vy > 0.7)) {
          // 滑出畫面後才關閉；如果關閉被攔下（例如「有未儲存的修改」確認被選了取消），面板自己彈回原位。
          Animated.timing(ty, { toValue: 700, duration: 180, useNativeDriver: native }).start(() => {
            closeRef.current();
            setTimeout(back, 60);
          });
        } else if (expandRef.current && -g.dy > maxUp.current * 0.5) {
          expanding.current = true;
          Animated.timing(ty, { toValue: -maxUp.current, duration: 120, useNativeDriver: native }).start(() => finishExpand());
        } else if (upRef.current && g.dy < -40) closeRef.current();
        else back();
      },
      onPanResponderTerminate: () => {
        if (!expanding.current) back();
      },
    }),
  ).current;
  const swipe = pan.panHandlers;
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop} {...swipe}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="關閉" onPress={onClose} />
        <Animated.View
          onLayout={(e) => setSheetH(Math.round(e.nativeEvent.layout.height))}
          style={[styles.sheet, sheetMax ? { width: "100%", maxWidth: sheetMax, alignSelf: "center" } : null, { backgroundColor: c.surface, paddingBottom: space.lg + insets.bottom, transform: [{ translateY: ty }] }, onExpand && Platform.OS === "web" ? ({ userSelect: "none" } as object) : null]}
          accessibilityViewIsModal
          {...swipe}
        >
          {onExpand ? (
            <>
              {/* 上拉時面板離開螢幕底部，下方用同色補滿；上方浮出提示文字 */}
              <View pointerEvents="none" style={[styles.fill, { backgroundColor: c.surface }]} />
              <Animated.View pointerEvents="none" style={[styles.hint, { opacity: ty.interpolate({ inputRange: [-80, -20, 0], outputRange: [1, 0, 0], extrapolate: "clamp" }) }]}>
                <View style={styles.hintPill}>
                  <AppText variant="caption" style={{ color: "#fff", fontWeight: "700" }}>
                    {expandLabel ?? "繼續上拉進入"}
                  </AppText>
                </View>
              </Animated.View>
            </>
          ) : null}
          <View style={[styles.handle, { backgroundColor: c.border }]} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", ...dimStyle },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, gap: space.md },
  fill: { position: "absolute", left: 0, right: 0, top: "100%", height: 1200 },
  hint: { position: "absolute", left: 0, right: 0, top: -40, alignItems: "center" },
  hintPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.6)" },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: space.xs },
});

/**
 * 上拉面板裡的清單捲動區：高度依內容自動調整（內容少就矮、多就長高），最高到螢幕高度的 62%，超過才捲動；寬度不變（業主 2026-11-17）。
 * 系列梯次、課程章節、廣播公告等所有上拉清單都用它，不要再寫固定的 maxHeight。
 */
export function SheetScroll({ children, gap = 0 }: { children: ReactNode; gap?: number }) {
  const { height } = useWindowDimensions();
  return (
    <ScrollView style={{ maxHeight: Math.round(height * 0.62), flexGrow: 0 }} contentContainerStyle={{ gap }}>
      {children}
    </ScrollView>
  );
}
