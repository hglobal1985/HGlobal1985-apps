import Ionicons from "@expo/vector-icons/Ionicons";
import { router, usePathname, type Href } from "expo-router";
import { useEffect, useState, type ComponentProps } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { requestCoursesReset } from "@/lib/courses-reset";
import { LIB, useLibraryMode } from "@/lib/library-mode";
import { getBottomGap, onBottomGap } from "@/lib/bottom-gap";
import { useUnreadCount } from "@/state/unread";
import { useLayout } from "@/theme/layout";
import { useTheme } from "@/theme/theme";
import { UI_SCALE } from "@/theme/ui-scale";

/** 底部分頁列高度（業主 2026-11-20：比一般工具列矮一點）。 */
const navHeight = Math.round((UI_SCALE > 1 ? 58 : 50) * UI_SCALE);
import { AppText } from "./text";
import { UniversityIcon } from "./university-icon";

type IconName = ComponentProps<typeof Ionicons>["name"];
/** 短網址（/縮寫）：單層路徑且不是網站固定頁面。 */
const FIXED = new Set(["/me", "/learning", "/notices", "/achievements", "/orders", "/courses", "/admin", "/settings", "/auth"]);
const isShortLink = (p: string) => /^\/[a-z0-9-]{2,30}$/i.test(p) && !FIXED.has(p);
const tabs: { href: Href; title: string; icon: IconName; active: IconName; building?: boolean; match: (p: string) => boolean }[] = [
  { href: "/", title: "首頁", icon: "home-outline", active: "home", match: (p) => p === "/" },
  { href: "/courses", title: "課程", icon: "library-outline", active: "library", building: true, match: (p) => p === "/courses" || p.startsWith("/course/") || p.startsWith("/series/") || isShortLink(p) },
  { href: "/learning", title: "學習中", icon: "play-circle-outline", active: "play-circle", match: (p) => p === "/learning" || p.startsWith("/learn/") },
  { href: "/notices", title: "通知", icon: "notifications-outline", active: "notifications", match: (p) => p === "/notices" },
  { href: "/me", title: "設定", icon: "person-circle-outline", active: "person-circle", match: (p) => p === "/me" || p.startsWith("/orders") || p.startsWith("/admin") || p.startsWith("/settings") },
];

/**
 * 底部分頁列：放在根版面，所有頁面（課程、上課、報名、管理、設定…）都會顯示，不會被推入的頁面蓋掉。
 * 登入中繼頁（/auth/*）與手機鍵盤開啟時隱藏。
 */
export function BottomBar() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const unread = useUnreadCount();
  const lib = useLibraryMode();
  const [keyboard, setKeyboard] = useState(false);
  // 加到主畫面的 App 底部多出的一塊（lib/bottom-gap.ts）：它本身就是底部安全距離，選單不再額外留白；一般瀏覽器分頁沒有這一塊，才自己留一點。
  const [edge, setEdge] = useState(getBottomGap());
  useEffect(() => onBottomGap(setEdge), []);
  // 大螢幕（業主 2026-11-18）：五個分頁集中在中間（不要散在整條寬螢幕兩端），圖示與文字放大一點。
  const { large } = useLayout();
  const iconSize = UI_SCALE > 1 ? 30 : 24; // 平板放大由 lib/global-scale.ts 統一處理；平板再加大（業主 2026-11-20）
  const iconBox = Math.round((iconSize + 4) * UI_SCALE); // 圖示本身會被全站放大，外框也要跟著放大，否則圖示會壓到下面的文字
  useEffect(() => {
    if (Platform.OS === "web") return;
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboard(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboard(false));
    return () => (show.remove(), hide.remove());
  }, []);
  // 網頁（加到主畫面的 App）：選單下方若有沒被畫面蓋到的區塊，底色與選單同色，不會露出白色。
  const barBg = lib ? LIB.card : c.navBar;
  const hidden = pathname.startsWith("/auth") || keyboard;
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined" || hidden) return;
    const el = document.documentElement;
    const old = el.style.backgroundColor;
    el.style.backgroundColor = barBg;
    return () => {
      el.style.backgroundColor = old;
    };
  }, [barBg, hidden]);
  if (hidden) return null;
  return (
    <View style={[styles.bar, { backgroundColor: lib ? LIB.card : c.navBar, paddingBottom: edge > 0 ? 0 : Math.min(insets.bottom, UI_SCALE > 1 ? 8 : 20) }]} accessibilityRole="tablist">
      <View style={[styles.row, large && styles.rowLarge]}>
      {tabs.map((t) => {
        const on = !lib && t.match(pathname);
        // 方案 1（業主 2026-11-20）：整條深綠實心、白字白圖示；目前所在分頁是黃色膠囊＋深色字。書櫃模式維持咖啡色舊樣式。
        const color = lib ? LIB.muted : on ? c.navPillText : "#FFFFFF";
        return (
          <Pressable key={t.title} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.title === "課程" ? "課程（寰宇大學）" : t.title} onPress={() => {
            if (t.title === "課程") requestCoursesReset();
            router.navigate(t.href);
          }}>
            <View style={[styles.cell, on && { backgroundColor: c.navPill }]}>
              <View style={{ width: iconBox, height: iconBox, alignItems: "center", justifyContent: "center" }}>
                {t.building ? <UniversityIcon size={iconSize} color={color} active={on} /> : <Ionicons name={on ? t.active : t.icon} size={iconSize} color={color} />}
                {t.title === "通知" && unread > 0 ? (
                  <View style={[styles.badge, { backgroundColor: "#E0382E", borderColor: lib ? LIB.card : c.navBar }]}>
                    <AppText variant="caption" style={{ color: "#FFFFFF", fontSize: 10, lineHeight: 12, fontWeight: "700" }}>
                      {unread > 9 ? "9+" : String(unread)}
                    </AppText>
                  </View>
                ) : null}
              </View>
              <AppText variant="caption" numberOfLines={1} style={{ color, fontWeight: "800", fontSize: UI_SCALE > 1 ? 16 : 12, lineHeight: UI_SCALE > 1 ? 20 : 14 }}>
                {t.title}
              </AppText>
            </View>
          </Pressable>
        );
      })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { alignItems: "center", minHeight: navHeight, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: -3 }, elevation: 10 },
  row: { flexDirection: "row", width: "100%" },
  rowLarge: { maxWidth: 760 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 3, paddingBottom: 3, minHeight: navHeight },
  cell: { alignItems: "center", justifyContent: "center", gap: UI_SCALE > 1 ? 4 : 1, paddingVertical: UI_SCALE > 1 ? 6 : 3, paddingHorizontal: 12, borderRadius: 16, minWidth: UI_SCALE > 1 ? 100 : 60 },
  badge: { position: "absolute", top: -4, right: -12, minWidth: 16, height: 16, borderRadius: 8, borderWidth: 1.5, paddingHorizontal: 3, alignItems: "center", justifyContent: "center" },
});
