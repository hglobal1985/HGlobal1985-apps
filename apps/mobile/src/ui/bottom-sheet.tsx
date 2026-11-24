import Ionicons from "@expo/vector-icons/Ionicons";
import { useModeProfile } from "@/lib/app-mode";
import { useEffect, useRef, useState, type ReactNode } from "react";
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

/**
 * 底部彈出面板的外框（從螢幕下方向上滑出、背後半透明、點外面等於取消）。
 * 「確認視窗」「改播詢問」等所有從下方彈出的面板都用它，樣式與手勢只在這裡改一次。
 *
 * 內建手勢（業主 2026-11-15 永久指示，所有上拉式選單一律有）：在面板或背景上往下滑，面板跟著手指移動；
 * 放開時滑過一小段就順勢滑出畫面並關閉（等同按取消），沒滑夠就彈回原位。
 * swipeUpClose＝連往上滑一小段也算關閉（分類篩選用：滑動等於確定套用）。
 * onExpand＝「上拉進入完整內容」（業主 2026-11-16）：按住面板上方的灰色膠囊（`handleHit`）往上拉（面板其他地方只能下滑收起，業主 2026-11-20 改），面板跟著手指長高；拉過約一半距離放開、或一路拉到最高處，
 * 就直接進入右上角那個按鈕對應的內頁（呼叫 onExpand）；沒拉夠就彈回。expandLabel＝上拉時顯示的提示文字。右上角按鈕請用 SheetAction。
 * 新增任何上拉式選單都必須用這個元件，不要自己用 Modal 重做。
 */
export function BottomSheet({ onClose, children, swipeUpClose = false, onExpand, expandLabel }: { onClose: () => void; children: ReactNode; swipeUpClose?: boolean; onExpand?: () => void; expandLabel?: string }) {
  const { c } = useTheme();
  const asPage = useModeProfile().sheets === "page";
  useDimLayer();
  const insets = useSafeAreaInsets();
  // 網頁（加到主畫面的 App）：面板下方若露出底部選單的綠色底色，改成面板同色，看起來是面板蓋到最底（業主 2026-11-24）。
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const el = document.documentElement;
    const old = el.style.backgroundColor;
    el.style.backgroundColor = c.surface;
    return () => {
      el.style.backgroundColor = old;
    };
  }, [c.surface]);
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
  // 上拉進入完整內容只有「按住上方灰色膠囊再往上拉」才會觸發（業主 2026-11-20，原本整個面板都能拉太容易誤觸）；
  // 面板其他地方只負責下滑收起。膠囊有自己的一組手勢（allowExpand），範圍放大到整條寬、好按。
  const makePan = (allowExpand: boolean) =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (e, g) =>
        Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2 && !(g.dy > 0 && !allowExpand && inScrolledList(e.target)) && !(g.dy < 0 && (!allowExpand || !expandRef.current)),
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
    });
  // 下滑關閉與上拉展開都只能「按住最上方灰色膠囊」拖曳才生效（業主 2026-11-22 全網設定）；面板其他地方、背景都不再有拖曳手勢（內容照常捲動、點背景仍會關閉）。
  const handlePan = useRef(makePan(true)).current;
  // 至尊模式一律不用上拉選單（業主 2026-11-24）：同一個元件改成整頁顯示（上方大大的「返回」），內容整頁捲動。
  // 全站所有上拉選單（確認、選擇、資料編輯…）都經過這裡，所以兩種模式的功能永遠一致，只是呈現方式不同。
  if (asPage)
    return (
      <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent>
        <View style={[styles.page, { backgroundColor: c.background, paddingTop: insets.top }]} accessibilityViewIsModal>
          <View style={[styles.pageBar, { borderBottomColor: c.border, backgroundColor: c.surface }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={onClose} hitSlop={8} style={styles.pageBack}>
              <Ionicons name="chevron-back" size={30} color={c.accentText} />
              <AppText variant="title" style={{ color: c.accentText }}>
                返回
              </AppText>
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.pageBody, { paddingBottom: space.xxl + insets.bottom }, sheetMax ? { width: "100%", maxWidth: sheetMax, alignSelf: "center" } : null]} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </Modal>
    );
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="關閉" onPress={onClose} />
        <Animated.View
          onLayout={(e) => setSheetH(Math.round(e.nativeEvent.layout.height))}
          style={[styles.sheet, sheetMax ? { width: "100%", maxWidth: sheetMax, alignSelf: "center" } : null, { backgroundColor: c.surface, paddingBottom: space.lg + insets.bottom, transform: [{ translateY: ty }] }, onExpand && Platform.OS === "web" ? ({ userSelect: "none" } as object) : null]}
          accessibilityViewIsModal
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
          <View {...handlePan.panHandlers} style={[styles.handleHit, Platform.OS === "web" ? ({ cursor: "grab", touchAction: "none" } as object) : null]} accessibilityLabel={onExpand ? "按住往上拉進入完整內容，往下拉關閉" : "按住往下拉關閉"}>
            <View style={[styles.handle, { backgroundColor: c.border }]} />
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", ...dimStyle },
  page: { flex: 1 },
  pageBar: { minHeight: 64, justifyContent: "center", paddingHorizontal: space.md, borderBottomWidth: 1 },
  pageBack: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 56, alignSelf: "flex-start", paddingRight: space.lg },
  pageBody: { padding: space.lg, gap: space.md },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, gap: space.md },
  fill: { position: "absolute", left: 0, right: 0, top: "100%", height: 1200 },
  hint: { position: "absolute", left: 0, right: 0, top: -40, alignItems: "center" },
  hintPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.6)" },
  handleHit: { alignSelf: "stretch", alignItems: "center", paddingVertical: 12, marginTop: -12, marginBottom: -12 + space.xs },
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
