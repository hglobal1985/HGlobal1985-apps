import { router, type Href } from "expo-router";
import { requestCoursesReset } from "@/lib/courses-reset";
import { requestHomeReset } from "@/lib/home-reset";
import { LIB, useLibraryMode } from "@/lib/library-mode";
import { MODE_PROFILES } from "@/lib/app-mode";
import { currentModeKey } from "@/lib/elder-mode";
import { switchToElder } from "@/features/elder/mode-actions";
import { useUnreadCount } from "@/state/unread";
import { UniversityIcon } from "@/ui/university-icon";
import type { NavTab } from "@/ui/nav-types";

/**
 * 行動大學的底部主選單設定（共用 BottomBar 讀這裡；杜杜龍 2026-11-26 拆出來，外觀與動畫在 packages/ui/src/ui/bottom-bar.tsx）。
 * 要改分頁、圖示、點擊行為只改這個檔案；要改選單外觀改共用元件（兩個 App 一起變）。
 */

/** 短網址（/縮寫）：單層路徑且不是網站固定頁面。 */
const FIXED = new Set(["/me", "/mode", "/learning", "/notices", "/achievements", "/orders", "/courses", "/album", "/admin", "/settings", "/auth"]);
const isShortLink = (p: string) => /^\/[a-z0-9-]{2,30}$/i.test(p) && !FIXED.has(p);
const coursesMatch = (p: string) => p === "/courses" || p === "/album" || p.startsWith("/course/") || p.startsWith("/series/") || isShortLink(p);

/**
 * 課程分頁最後停留的頁面（杜杜龍 2026-11-23）：在課程分頁裡（寰宇大學、系列、課程內頁、短網址…）看到哪一頁，就記住；
 * 切到其他分頁再按「課程」會回到那一頁；人已經在課程分頁裡再按一次「課程」，才回到課程首頁（所有系列）。
 * 只記在這次開啟期間（記憶體），不存裝置。只記導覽套件的路徑（不用網址列：課程頁自己會把網址列改成中心短網址等，拿去導覽會卡住，杜杜龍 2026-11-23）。
 */
let lastCoursesHref: string | null = null;

export const NAV_TABS: NavTab[] = [
  {
    key: "home",
    href: "/",
    title: "首頁",
    icon: "home-outline",
    active: "home",
    match: (p) => p === "/",
    // 已經在首頁再按一次首頁＝清掉首頁狀態、回到預設值（杜杜龍 2026-11-25）。
    onPress: (on) => {
      if (on) requestHomeReset();
      router.navigate("/");
    },
  },
  {
    key: "courses",
    href: "/courses",
    title: "課程",
    a11y: "課程（寰宇大學）",
    icon: "library-outline",
    active: "library",
    renderIcon: (size, color, on) => <UniversityIcon size={size} color={color} active={on} />,
    match: coursesMatch,
    onPress: (on) => {
      if (on) {
        requestCoursesReset();
        router.navigate("/courses");
      } else router.navigate((lastCoursesHref ?? "/courses") as Href);
    },
  },
  { key: "learning", href: "/learning", title: "學習中", icon: "play-circle-outline", active: "play-circle", match: (p) => p === "/learning" || p.startsWith("/learn/") },
  { key: "notices", href: "/notices", title: "通知", icon: "notifications-outline", active: "notifications", match: (p) => p === "/notices" },
  { key: "settings", href: "/me", title: "設定", icon: "person-circle-outline", active: "person-circle", match: (p) => p === "/me" || p.startsWith("/orders") || p.startsWith("/admin") || p.startsWith("/settings") },
];

export const MODE_PAGE = "/mode";

export function useNavTrack(pathname: string): void {
  if (coursesMatch(pathname)) lastCoursesHref = pathname;
}

/** 行動大學沒有要依身分藏起來的分頁。 */
export function useNavHidden(): string[] {
  return [];
}

export function useNavBadges(): Partial<Record<string, number>> {
  return { notices: useUnreadCount() };
}

/** 書櫃頁面自成咖啡色系（lib/library-mode.ts）：選單變咖啡色、不亮任何分頁、不顯示模式鍵。 */
export function useNavSkin(): { bg: string; fg: string } | null {
  return useLibraryMode() ? { bg: LIB.card, fg: LIB.muted } : null;
}

/** 模式鍵：超派模式＝直接切到至尊模式；至尊模式＝打開模式頁（字體大小、訂單紀錄、帳號、換回超派模式）。 */
export function onModeKey(): void {
  if (MODE_PROFILES[currentModeKey()].modeKey === "page") router.navigate(MODE_PAGE);
  else switchToElder();
}
