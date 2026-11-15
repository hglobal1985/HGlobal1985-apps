import { useRef, type ReactNode } from "react";
import { Animated, Modal, PanResponder, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";

/** 網頁：手指按的位置在「已經往下捲過的清單」裡時，不攔截手勢（讓清單自己捲動，不會誤收起面板）。 */
function inScrolledList(target: unknown): boolean {
  if (Platform.OS !== "web" || typeof document === "undefined") return false;
  for (let n = target as Element | null; n && n !== document.body; n = n.parentElement) {
    const st = getComputedStyle(n);
    if ((st.overflowY === "auto" || st.overflowY === "scroll") && n.scrollHeight > n.clientHeight && n.scrollTop > 0) return true;
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
 * 新增任何上拉式選單都必須用這個元件，不要自己用 Modal 重做。
 */
export function BottomSheet({ onClose, children, swipeUpClose = false }: { onClose: () => void; children: ReactNode; swipeUpClose?: boolean }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const upRef = useRef(swipeUpClose);
  upRef.current = swipeUpClose;
  const ty = useRef(new Animated.Value(0)).current;
  const native = Platform.OS !== "web";
  const back = () => Animated.spring(ty, { toValue: 0, useNativeDriver: native }).start();
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (e, g) => Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2 && !(g.dy > 0 && inScrolledList(e.target)),
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) ty.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 70 || (g.dy > 25 && g.vy > 0.7)) {
          // 滑出畫面後才關閉；如果關閉被攔下（例如「有未儲存的修改」確認被選了取消），面板自己彈回原位。
          Animated.timing(ty, { toValue: 700, duration: 180, useNativeDriver: native }).start(() => {
            closeRef.current();
            setTimeout(back, 60);
          });
        } else if (upRef.current && g.dy < -40) closeRef.current();
        else back();
      },
      onPanResponderTerminate: back,
    }),
  ).current;
  const swipe = pan.panHandlers;
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop} {...swipe}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="關閉" onPress={onClose} />
        <Animated.View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: space.lg + insets.bottom, transform: [{ translateY: ty }] }]} accessibilityViewIsModal {...swipe}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, gap: space.md },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: space.xs },
});
