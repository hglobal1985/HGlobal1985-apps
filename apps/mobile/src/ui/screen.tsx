import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Animated, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/theme";
import { maxContentWidth, space } from "@/theme/tokens";
import { usePullRefresh } from "./pull-refresh";
import { AppText } from "./text";

const FooterSlot = createContext<((node: ReactNode) => void) | null>(null);

/**
 * 頁面下方固定的操作列（貼在底部主選單上方，內容捲動時不會跟著跑）。
 * 在 Screen 裡面的元件呼叫，傳入要固定的按鈕列（傳 null＝不顯示）；離開頁面時自動移除。
 * 狀態在子元件裡的表單（例如繳費表單）用這個；狀態在頁面本身的，直接用 Screen 的 footer 參數。
 */
export function useScreenFooter(node: ReactNode): void {
  const set = useContext(FooterSlot);
  useEffect(() => {
    set?.(node);
  });
  useEffect(() => () => set?.(null), [set]);
}

/**
 * 分頁頁面的外框：處理安全區、背景色、網頁最大寬度與大標題。
 * 推入的詳情頁使用系統導覽列，傳入 `header={false}`。
 */
export function Screen({
  title,
  subtitle,
  right,
  children,
  header = true,
  tight = false,
  gap = space.lg,
  footer,
  top,
  topBar,
  hero,
  heroHeight = 0,
  scrollY,
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  header?: boolean;
  /** 上方留白縮小（內容要貼近上方影片時用）。 */
  tight?: boolean;
  /** 各區塊之間的間距（預設 space.lg）。 */
  gap?: number;
  /** 固定在頁面下方（底部主選單上方）的操作列，例如「報名」、「取消報名／送出」。不會跟著內容捲動。 */
  footer?: ReactNode;
  /** 固定在頁面最上方的功能列（篩選、搜尋…）：往下捲動內容時它永遠留在最上面、不會跟著捲走。 */
  top?: ReactNode;
  /** 最上方的返回工具列（TopBar）：滿版、不受頁面左右留白影響，放在 top 功能列之前。 */
  topBar?: ReactNode;
  /** 固定在上方功能列之下、捲動區之上的滿版區塊（例如中心頁的照片）；搭配 scrollY 讓它隨捲動縮放。 */
  hero?: ReactNode;
  /** hero 完全展開時的高度：捲動內容最上方會墊出同樣高的空間（hero 是蓋在捲動區上面的浮動層，不改變捲動區大小，避免課程少時來回閃動）。 */
  heroHeight?: number;
  /** 提供時，頁面捲動位移會寫進這個 Animated.Value（hero 內插縮放用）。 */
  scrollY?: Animated.Value;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const refreshControl = usePullRefresh();
  const [slot, setSlot] = useState<ReactNode>(null);
  const bar = footer ?? slot;
  return (
    <FooterSlot.Provider value={setSlot}>
    <View style={{ flex: 1 }}>
    {topBar ? <View style={{ zIndex: 6 }}>{topBar}</View> : null}
    {top ? (
      <View style={[styles.top, { backgroundColor: c.background, borderBottomColor: c.border, paddingTop: (header ? insets.top : 0) + space.sm }]}>
        <View style={styles.topInner}>{top}</View>
      </View>
    ) : null}
    <View style={{ flex: 1 }}>
    {hero ? <View style={[styles.heroLayer, { backgroundColor: c.background }]}>{hero}</View> : null}
    <Scroller
      scrollY={scrollY}
      refreshControl={refreshControl}
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: (top ? space.md : (header ? insets.top : 0) + (tight ? space.xs : space.lg)) + (hero ? heroHeight : 0), paddingBottom: space.xxl },
      ]}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={[styles.inner, { gap }]}>
        {header && (title || subtitle || right) ? (
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              {title ? (
                <AppText variant="display" accessibilityRole="header">
                  {title}
                </AppText>
              ) : null}
              {subtitle ? (
                <AppText tone="muted" variant="callout">
                  {subtitle}
                </AppText>
              ) : null}
            </View>
            {right}
          </View>
        ) : null}
        {children}
      </View>
    </Scroller>
    </View>
    {bar ? (
      <View style={[styles.footer, { backgroundColor: c.surface, borderTopColor: c.border }]}>
        <View style={styles.footerInner}>{bar}</View>
      </View>
    ) : null}
    </View>
    </FooterSlot.Provider>
  );
}

/** 有 scrollY 就用 Animated.ScrollView 把捲動位移寫進去，否則就是一般的 ScrollView。 */
function Scroller({ scrollY, children, ...props }: { scrollY?: Animated.Value } & React.ComponentProps<typeof ScrollView>) {
  // 網頁：頁面主要捲動區固定預留捲軸位置（lib/stable-scrollbar.ts 只認這個標記，避免外層每一層都多留一條捲軸寬度）。
  const rest = { ...props, ...({ dataSet: { stableGutter: "" } } as object) };
  if (!scrollY) return <ScrollView {...rest}>{children}</ScrollView>;
  return (
    <Animated.ScrollView {...(rest as object)} scrollEventThrottle={16} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}>
      {children}
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, alignItems: "center" },
  heroLayer: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 4 },
  inner: { width: "100%", maxWidth: maxContentWidth, gap: space.lg },
  top: { alignItems: "center", paddingHorizontal: space.lg, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 5, elevation: 3, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  topInner: { width: "100%", maxWidth: maxContentWidth },
  footer: { alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm, borderTopWidth: 1, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: -2 }, elevation: 6 },
  footerInner: { width: "100%", maxWidth: maxContentWidth, gap: space.sm },
  header: { flexDirection: "row", alignItems: "flex-end", gap: space.md, marginBottom: space.xs },
});
