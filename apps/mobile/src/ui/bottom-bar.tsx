import Ionicons from "@expo/vector-icons/Ionicons";
import { router, usePathname, type Href } from "expo-router";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Animated, Keyboard, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { requestCoursesReset } from "@/lib/courses-reset";
import { requestHomeReset } from "@/lib/home-reset";
import { LIB, useLibraryMode } from "@/lib/library-mode";
import { runGuarded } from "@/lib/unsaved-guard";
import { getBottomGap, onBottomGap } from "@/lib/bottom-gap";
import { useUnreadCount } from "@/state/unread";
import { MODE_PROFILES, useModeProfile, type TabKey } from "@/lib/app-mode";
import { CrownIcon } from "@/features/elder/crown-icon";
import { switchToElder } from "@/features/elder/mode-actions";
import { useLayout } from "@/theme/layout";
import { useTheme } from "@/theme/theme";
import { UI_SCALE } from "@/theme/ui-scale";

/** 底部分頁列高度（業主 2026-11-20：比一般工具列矮一點）。 */
const navHeight = Math.round((UI_SCALE > 1 ? 58 : 50) * UI_SCALE);
/** 至尊模式（業主 2026-11-24）：底部選單加高、字與圖示加大（固定大小，不跟著至尊字體倍數再放大，否則四個分頁會擠不下）。 */
const elderNavHeight = Math.round((UI_SCALE > 1 ? 80 : 72) * UI_SCALE);
/** 超派模式的模式鍵圖示（業主 2026-11-24 從五個方案挑選：方案 3 火箭）。 */
const MAKER_ICON: IconName = "rocket-outline";
/** 只吃平板／電腦倍數、不吃至尊模式倍數（lib/global-scale.ts）。 */
const UI_ONLY = { dataSet: { uiOnly: "" } } as object;
import { AppText } from "./text";
import { UniversityIcon } from "./university-icon";

type IconName = ComponentProps<typeof Ionicons>["name"];
/** 短網址（/縮寫）：單層路徑且不是網站固定頁面。 */
const FIXED = new Set(["/me", "/mode", "/learning", "/notices", "/achievements", "/orders", "/courses", "/albums", "/admin", "/settings", "/auth"]);
const isShortLink = (p: string) => /^\/[a-z0-9-]{2,30}$/i.test(p) && !FIXED.has(p);
const tabs: { key: TabKey; href: Href; title: string; icon: IconName; active: IconName; building?: boolean; match: (p: string) => boolean }[] = [
  { key: "home", href: "/", title: "首頁", icon: "home-outline", active: "home", match: (p) => p === "/" },
  { key: "courses", href: "/courses", title: "課程", icon: "library-outline", active: "library", building: true, match: (p) => p === "/courses" || p === "/albums" || p.startsWith("/course/") || p.startsWith("/series/") || isShortLink(p) },
  { key: "learning", href: "/learning", title: "學習中", icon: "play-circle-outline", active: "play-circle", match: (p) => p === "/learning" || p.startsWith("/learn/") },
  { key: "notices", href: "/notices", title: "通知", icon: "notifications-outline", active: "notifications", match: (p) => p === "/notices" },
  { key: "settings", href: "/me", title: "設定", icon: "person-circle-outline", active: "person-circle", match: (p) => p === "/me" || p.startsWith("/orders") || p.startsWith("/admin") || p.startsWith("/settings") },
];

/**
 * 課程分頁最後停留的頁面（業主 2026-11-23）：在課程分頁裡（寰宇大學、系列、課程內頁、短網址…）看到哪一頁，就記住；
 * 切到其他分頁再按「課程」會回到那一頁；人已經在課程分頁裡再按一次「課程」，才回到課程首頁（所有系列）。
 * 只記在這次開啟期間（記憶體），不存裝置。
 */
let lastCoursesHref: string | null = null;

/**
 * 超派模式的模式鍵「偷看」動畫（業主 2026-11-24）：平常顯示「超派＋火箭」，每隔 3 秒換成「至尊＋皇冠」閃爍幾下，再換回「超派＋火箭」，
 * 提醒使用者這裡可以切換到至尊模式。只在超派模式執行（至尊模式固定顯示「至尊＋皇冠」）。
 */
/** 網頁：最近有捲動（含系統「滾動截圖」自動捲動）就暫停模式鍵動畫（業主 2026-11-25：手機系統提示「此頁面有影響拼接效果的功能」，畫面一直在變動會讓長截圖拼接失敗）。 */
let lastScrollAt = 0;
if (Platform.OS === "web" && typeof window !== "undefined") window.addEventListener("scroll", () => (lastScrollAt = Date.now()), { capture: true, passive: true });
const recentlyScrolled = () => Platform.OS === "web" && Date.now() - lastScrollAt < 10_000;

function useModePeek(enabled: boolean) {
  const [peek, setPeek] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!enabled) {
      setPeek(false);
      fade.setValue(1);
      return;
    }
    const native = Platform.OS !== "web";
    const to = (v: number, d: number) => Animated.timing(fade, { toValue: v, duration: d, useNativeDriver: native });
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false; // 動畫進行中
    let lastAt = 0; // 這一輪動畫開始的時間
    const cycle = () => {
      timer = setTimeout(() => {
        if (!alive) return;
        if (recentlyScrolled()) return cycle(); // 正在捲動／截圖：這一輪不動，3 秒後再看
        // 淡出火箭 → 換成皇冠 → 閃爍兩下 → 淡出 → 換回火箭
        busy = true;
        lastAt = Date.now();
        to(0, 160).start(() => {
          if (!alive) return;
          setPeek(true);
          Animated.sequence([to(1, 160), to(0.25, 220), to(1, 220), to(0.25, 220), to(1, 220), Animated.delay(250), to(0, 160)]).start(() => {
            if (!alive) return;
            setPeek(false);
            to(1, 160).start(() => {
              busy = false;
              if (alive) cycle();
            });
          });
        });
      }, 3000);
    };
    cycle();
    // 保險（業主 2026-11-25 回報：右下角模式鍵有時整個消失＝透明度卡在 0，例如分頁在背景時動畫被暫停）：
    // 動畫超過 3 秒還沒走完，或沒在動畫卻不是完全不透明，就強制還原成完全顯示並重新排程。
    const watchdog = setInterval(() => {
      if (!alive) return;
      if (busy && Date.now() - lastAt > 3000) {
        fade.stopAnimation();
        fade.setValue(1);
        setPeek(false);
        busy = false;
        if (timer) clearTimeout(timer);
        cycle();
      }
    }, 1000);
    return () => {
      clearInterval(watchdog);
      alive = false;
      if (timer) clearTimeout(timer);
      fade.stopAnimation();
      fade.setValue(1);
      setPeek(false);
    };
  }, [enabled, fade]);
  return { peek, fade };
}

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
  // 至尊模式：不顯示「設定」分頁；最右邊的模式鍵（超派模式顯示「至尊」、至尊模式顯示「超派」）。
  // 要顯示哪些分頁、選單要不要放大、模式鍵的文字，都看使用模式設定檔（lib/app-mode.tsx）。
  const profile = useModeProfile();
  const elder = profile.bigNav;
  const shown = profile.tabs.map((k) => tabs.find((t) => t.key === k)!).filter(Boolean);
  const [keyboard, setKeyboard] = useState(false);
  // 加到主畫面的 App 底部多出的一塊（lib/bottom-gap.ts）：它本身就是底部安全距離，選單不再額外留白；一般瀏覽器分頁沒有這一塊，才自己留一點。
  const [edge, setEdge] = useState(getBottomGap());
  useEffect(() => onBottomGap(setEdge), []);
  // 大螢幕（業主 2026-11-18）：五個分頁集中在中間（不要散在整條寬螢幕兩端），圖示與文字放大一點。
  const { large } = useLayout();
  const iconSize = elder ? (UI_SCALE > 1 ? 36 : 30) : UI_SCALE > 1 ? 30 : 24; // 平板放大由 lib/global-scale.ts 統一處理；平板再加大（業主 2026-11-20）
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
  // 記住課程分頁最後停留的頁面：只記導覽套件的路徑（不用網址列：課程頁自己會把網址列改成中心短網址等，拿去導覽會卡住，業主 2026-11-23 回報再點「課程」沒反應）。
  // 寰宇大學（/courses）的篩選與中心頁狀態本來就留在畫面上，回 /courses 即可還原。
  useEffect(() => {
    if (tabs[1]!.match(pathname)) lastCoursesHref = pathname;
  }, [pathname]);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined" || hidden) return;
    const el = document.documentElement;
    const old = el.style.backgroundColor;
    el.style.backgroundColor = barBg;
    return () => {
      el.style.backgroundColor = old;
    };
  }, [barBg, hidden]);
  const { peek, fade: peekFade } = useModePeek(!lib && !hidden && profile.key !== "elder");
  const showElder = profile.key === "elder" || peek;
  if (hidden) return null;
  // 在模式頁（/mode）時，模式鍵跟其他分頁一樣亮起黃色膠囊。
  const modeOn = !lib && pathname === "/mode";
  const modeColor = modeOn ? c.navPillText : "#FFFFFF";
  const labelSize = elder ? (UI_SCALE > 1 ? 19 : 17) : UI_SCALE > 1 ? 16 : 12;
  const tabStyle = [styles.tab, elder && { minHeight: elderNavHeight }];
  return (
    <>
    <View style={[styles.bar, elder && { minHeight: elderNavHeight }, { backgroundColor: lib ? LIB.card : c.navBar, paddingBottom: edge > 0 ? 0 : Math.min(insets.bottom, UI_SCALE > 1 ? 8 : 20) }]} accessibilityRole="tablist">
      <View style={[styles.row, large && styles.rowLarge]}>
      {shown.map((t) => {
        const on = !lib && t.match(pathname);
        // 方案 1（業主 2026-11-20）：整條深綠實心、白字白圖示；目前所在分頁是黃色膠囊＋深色字。書櫃模式維持咖啡色舊樣式。
        const color = lib ? LIB.muted : on ? c.navPillText : "#FFFFFF";
        return (
          <Pressable key={t.title} style={tabStyle} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.title === "課程" ? "課程（寰宇大學）" : t.title} onPress={() => runGuarded(() => {
            if (t.title === "課程") {
              // 已經在課程分頁裡再按一次＝回課程首頁（所有系列）；從別的分頁回來＝回到上次停留的那一頁（業主 2026-11-23）。
              if (t.match(pathname)) {
                requestCoursesReset();
                router.navigate(t.href);
              } else router.navigate((lastCoursesHref ?? t.href) as Href);
              return;
            }
            // 已經在首頁再按一次首頁＝清掉首頁狀態、回到預設值（業主 2026-11-25）。
            if (t.title === "首頁" && t.match(pathname)) requestHomeReset();
            router.navigate(t.href);
          })}>
            <View style={[styles.cell, elder && styles.cellElder, on && { backgroundColor: c.navPill }]}>
              <View style={{ width: iconBox, height: iconBox, alignItems: "center", justifyContent: "center" }}>
                {t.building ? <UniversityIcon size={iconSize} color={color} active={on} /> : <Ionicons name={on ? t.active : t.icon} size={iconSize} color={color} {...({ uiOnly: true } as object)} />}
                {t.title === "通知" && unread > 0 ? (
                  <View style={[styles.badge, { backgroundColor: "#E0382E", borderColor: lib ? LIB.card : c.navBar }]}>
                    <AppText variant="caption" style={{ color: "#FFFFFF", fontSize: elder ? 13 : 10, lineHeight: elder ? 15 : 12, fontWeight: "700" }} {...UI_ONLY}>
                      {unread > 9 ? "9+" : String(unread)}
                    </AppText>
                  </View>
                ) : null}
              </View>
              <AppText variant="caption" numberOfLines={1} style={{ color, fontWeight: "800", fontSize: labelSize, lineHeight: Math.round(labelSize * 1.2) }} {...UI_ONLY}>
                {t.title}
              </AppText>
            </View>
          </Pressable>
        );
      })}
      {/* 模式鍵（業主 2026-11-24）：放在「設定」右邊，樣式跟其他分頁一樣（不加黃色底框）；文字與圖示顯示「目前的模式」：
          超派模式＝「超派」＋MAKER_ICON，按下直接切到至尊模式；至尊模式＝「至尊」＋皇冠，按下打開面板（字體大小、訂單紀錄、帳號、換回超派模式）。書櫃頁面不顯示。 */}
      {lib ? null : (
        <Pressable
          style={tabStyle}
          accessibilityRole="button"
          accessibilityLabel={profile.key === "elder" ? `目前是${profile.name}模式。按這裡調整字體、看訂單紀錄、帳號，或換回${MODE_PROFILES.super.name}模式` : `目前是${profile.name}模式。按這裡切換到${MODE_PROFILES.elder.name}模式（大字簡易版）`}
          onPress={() => runGuarded(() => (profile.modeKey === "page" ? router.navigate("/mode") : switchToElder()))}
        >
          <Animated.View style={[styles.cell, elder && styles.cellElder, modeOn && { backgroundColor: c.navPill }, profile.key === "elder" ? null : { opacity: peekFade }]}>
            <View style={{ width: iconBox, height: iconBox, alignItems: "center", justifyContent: "center" }}>
              {showElder ? <CrownIcon size={Math.round(iconSize * UI_SCALE)} color={modeColor} /> : <Ionicons name={MAKER_ICON} size={iconSize} color={modeColor} {...({ uiOnly: true } as object)} />}
            </View>
            <AppText variant="caption" numberOfLines={1} style={{ color: modeColor, fontWeight: "800", fontSize: labelSize, lineHeight: Math.round(labelSize * 1.2) }} {...UI_ONLY}>
              {showElder ? MODE_PROFILES.elder.name : profile.name}
            </AppText>
          </Animated.View>
        </Pressable>
      )}
      </View>
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  bar: { alignItems: "center", minHeight: navHeight, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: -3 }, elevation: 10 },
  row: { flexDirection: "row", width: "100%" },
  rowLarge: { maxWidth: 760 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 3, paddingBottom: 3, minHeight: navHeight },
  cell: { alignItems: "center", justifyContent: "center", gap: UI_SCALE > 1 ? 4 : 1, paddingVertical: UI_SCALE > 1 ? 6 : 3, paddingHorizontal: UI_SCALE > 1 ? 12 : 8, borderRadius: 16, minWidth: UI_SCALE > 1 ? 100 : 56 },
  cellElder: { paddingHorizontal: 6, paddingVertical: UI_SCALE > 1 ? 8 : 6, minWidth: UI_SCALE > 1 ? 110 : 66 },
  badge: { position: "absolute", top: -4, right: -12, minWidth: 16, height: 16, borderRadius: 8, borderWidth: 1.5, paddingHorizontal: 3, alignItems: "center", justifyContent: "center" },
});
