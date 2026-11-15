import { useRef, type ReactNode } from "react";
import { Animated, Modal, PanResponder, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";

/**
 * 底部彈出面板的外框（從螢幕下方向上滑出、背後半透明、點外面等於取消）。
 * 「確認視窗」「改播詢問」等所有從下方彈出的面板都用它，樣式只在這裡改一次。
 */
export function BottomSheet({ onClose, children, swipeToClose = false }: { onClose: () => void; children: ReactNode; /** 在面板或背景上往上、往下滑動一小段＝關閉（分類篩選用：滑動等於確定套用）。 */ swipeToClose?: boolean }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // 往下滑：面板跟著手指移動；放開時超過一小段就順勢滑出畫面再關閉，沒超過就彈回原位。往上滑一小段＝直接關閉。
  const ty = useRef(new Animated.Value(0)).current;
  const native = Platform.OS !== "web";
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) ty.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 70 || (g.dy > 25 && g.vy > 0.7)) Animated.timing(ty, { toValue: 700, duration: 180, useNativeDriver: native }).start(() => closeRef.current());
        else if (g.dy < -40) closeRef.current();
        else Animated.spring(ty, { toValue: 0, useNativeDriver: native }).start();
      },
      onPanResponderTerminate: () => Animated.spring(ty, { toValue: 0, useNativeDriver: native }).start(),
    }),
  ).current;
  const swipe = swipeToClose ? pan.panHandlers : {};
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
