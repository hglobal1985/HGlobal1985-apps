import Ionicons from "@expo/vector-icons/Ionicons";
import { router, usePathname } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/theme";
import { inAppBrowser } from "@/lib/in-app-browser";
import { barHeight, minTouch } from "@/theme/tokens";
import { InAppBrowserBanner } from "./in-app-banner";

/**
 * 全站「上方返回工具列」的唯一來源（業主 2026-11-15 永久指示：所有頁面的上方工具列一律一致）。
 * 返回鍵（左）＋標題＋右側按鈕（編輯、分享…）；高度、字型、陰影都只在這裡定義。
 * 用法有兩種：①全站頁面堆疊（app/_layout.tsx 的 Stack header）自動套用；②頁面內的狀態頁（例如中心專屬頁）直接放這個元件。
 * safeTop＝畫面延伸到手機狀態列底下時，把安全區算進高度（頁面堆疊用 true；放在 Screen 裡的用 false，Screen 已經留了）。
 */
/**
 * backTo（業主 2026-11-17）：沒有上一頁可回（直接從分享網址進來）時，返回鍵要去的「上一層」頁面，例如中心主辦的課程＝該中心專屬頁。
 * 有上一頁就照常回上一頁；沒有傳 backTo 才用下面依網址判斷的預設。
 */
export function TopBar({ title, onBack, right, safeTop = false, shadow = !safeTop, backTo }: { title: string; onBack?: () => void; right?: ReactNode; safeTop?: boolean; shadow?: boolean; backTo?: string }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const fallback = path.startsWith("/course") || path.startsWith("/learn") ? "/courses" : path.startsWith("/orders") || path.startsWith("/admin") || path.startsWith("/settings") || path.startsWith("/achievements") ? "/me" : "/";
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace((backTo ?? fallback) as never)));
  const top = safeTop ? insets.top : 0;
  return (
    <View style={styles.wrap}>
      <View style={[styles.bar, { height: barHeight + top, paddingTop: top, backgroundColor: c.surface }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回上一頁" hitSlop={8} onPress={back} style={styles.back}>
          <Ionicons name="arrow-back" size={26} color={c.text} />
        </Pressable>
        <Text numberOfLines={1} accessibilityRole="header" style={[styles.title, { color: c.text }]}>
          {title}
        </Text>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
      {/* App 內建瀏覽器警示條：全站頁面堆疊的標題列正下方（業主 2026-11-17）；五個主分頁在 (tabs)/_layout 放。 */}
      {safeTop ? <InAppBrowserBanner /> : null}
      {/* 放在頁面內容裡的工具列（例如中心專屬頁）自己畫下緣陰影；全站頁面堆疊的標題列改由根版面的 TopBarShadow 統一疊上去（頁面內容會蓋住標題列本身的陰影）。 */}
      {shadow ? (
        <View pointerEvents="none" style={styles.shadow}>
          <ShadowStrips />
        </View>
      ) : null}
    </View>
  );
}

/** 下緣陰影：四層由深到淺的漸層，與底部主選單的陰影呼應。 */
function ShadowStrips() {
  return (
    <>
      {[0.16, 0.1, 0.05, 0.02].map((o, i) => (
        <View key={i} style={{ height: 2, backgroundColor: `rgba(0,0,0,${o})` }} />
      ))}
    </>
  );
}

const TAB_ROOTS = new Set(["/", "/courses", "/learning", "/notices", "/me"]);

/** 全站頁面堆疊標題列的下緣陰影（放在根版面，疊在所有頁面內容上）。五個主分頁與登入中繼頁沒有堆疊標題列，不顯示。 */
export function TopBarShadow() {
  const insets = useSafeAreaInsets();
  const path = usePathname();
  if (TAB_ROOTS.has(path) || path.startsWith("/auth") || inAppBrowser()) return null; // 警示條有自己的下緣線
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: insets.top + barHeight, zIndex: 20 }}>
      <ShadowStrips />
    </View>
  );
}

/** 上方工具列右側的按鈕（圖示＋文字）：「編輯」「分享」等都用它，字型與間距永遠一樣。tone＝accent（綠色，例如編輯）或 text（一般文字色，例如分享）。 */
export function TopBarButton({ label, icon, iconName, onPress, tone = "accent", accessibilityLabel }: { label: string; icon?: ReactNode; iconName?: React.ComponentProps<typeof Ionicons>["name"]; onPress: () => void; tone?: "accent" | "text"; accessibilityLabel?: string }) {
  const { c } = useTheme();
  const color = tone === "accent" ? c.accent : c.text;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} hitSlop={8} style={styles.btn}>
      {icon ?? (iconName ? <Ionicons name={iconName} size={22} color={color} /> : null)}
      <Text style={{ color, fontSize: 17, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { zIndex: 10, position: "relative" },
  bar: { flexDirection: "row", alignItems: "center" },
  back: { width: 48, height: 48, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  title: { flex: 1, minWidth: 0, marginLeft: 4, fontSize: 18, fontWeight: "500" },
  right: { flexDirection: "row", alignItems: "center", paddingRight: 6 },
  btn: { minWidth: minTouch, height: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 6 },
  shadow: { position: "absolute", left: 0, right: 0, top: "100%" },
});
