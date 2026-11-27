import { useEffect, useRef } from "react";
import { setElder, getElder } from "@/lib/elder-mode";
import { useSession } from "@/state/session";
import { flashText } from "@/ui/flash-notice";
import type { NavTab } from "@/ui/nav-types";

/**
 * 繳作業系統的底部主選單設定（外觀與動畫是共用元件 packages/ui/src/ui/bottom-bar.tsx，與行動大學同一個）。
 * 「批改」只給老師、管理員、組長看（useNavHidden）。
 */
export const NAV_TABS: NavTab[] = [
  { key: "home", href: "/", title: "作業", icon: "document-text-outline", active: "document-text", match: (p) => p === "/" || p.startsWith("/activity") || p.startsWith("/item") || p.startsWith("/sub/") || p.startsWith("/manage") || p.startsWith("/groups") || p.startsWith("/join") },
  { key: "review", href: "/review", title: "批改", icon: "checkmark-done-outline", active: "checkmark-done", match: (p) => p.startsWith("/review") },
  { key: "notices", href: "/notices", title: "通知", icon: "notifications-outline", active: "notifications", match: (p) => p === "/notices" },
  { key: "me", href: "/me", title: "我的", icon: "person-circle-outline", active: "person-circle", match: (p) => p === "/me" || p.startsWith("/files") || p.startsWith("/settings") },
];

/** 繳作業系統沒有獨立的模式頁：模式鍵直接切換。 */
export const MODE_PAGE: string | null = null;

/** 換頁時順便更新未讀數與待批改數（最多 15 秒一次）。 */
export function useNavTrack(pathname: string): void {
  const { reloadMe, signedIn } = useSession();
  const last = useRef(0);
  useEffect(() => {
    if (!signedIn || Date.now() - last.current < 15_000) return;
    last.current = Date.now();
    void reloadMe();
  }, [pathname, signedIn, reloadMe]);
}

export function useNavBadges(): Partial<Record<string, number>> {
  const { me } = useSession();
  return { notices: me?.unread ?? 0, review: me?.toReview ?? 0 };
}

export function useNavHidden(): string[] {
  const { me } = useSession();
  return me?.staff ? [] : ["review"];
}

export function useNavSkin(): { bg: string; fg: string } | null {
  return null;
}

/** 模式鍵：超派 ⇄ 至尊（字放大、選單改成整頁）。 */
export function onModeKey(): void {
  const on = !getElder().on;
  setElder({ on });
  flashText(on ? "已切換到至尊模式，字放大、操作更簡單" : "已切換到超派模式");
}
