import { usePathname } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { resetBandScroll, useBandScroll } from "./band-scroll";
import { useModeProfile } from "@/lib/app-mode";
import { space } from "@/theme/tokens";

/**
 * 「下滑縮小」的封面／影片區模組（業主 2026-11-24 永久指示：套用全網，超派、至尊、App、網頁同一份）。
 * 設計＝中心頁、系列頁封面（CenterHero）與課程頁迷你播放器的同一套：頁面往下滑，上方的封面或影片區平順縮小，
 * 縮到「窄橫幅」（COMPACT_H）為止，內容第一列永遠接在它下面；往上滑回頂端再展開。照片、短影音輪播都在裡面照常播放。
 * 有影片在播放時，課程頁改由全站播放器（features/player）縮成浮動小視窗，不走這裡。
 *
 * 用法：把封面／影片區包在 <CollapseBand>…</CollapseBand> 裡（放在釘在上方、不會跟內容一起捲走的位置）。
 * 數字（窄橫幅高度、縮放範圍）只在這個檔案定義；中心頁、系列頁的 CenterHero 也用這裡的常數，不可再各自定義。
 */
export const COMPACT_H = 112;
export const COMPACT_SIDE = 16;
/** 縮成窄橫幅時，封面上下留白合計（上 8＋下 4）。 */
export const COMPACT_GAP = space.sm + space.xs;

/** 上方標題列（TopBar）下滑縮小：捲動多少像素縮到最小、縮到多高（維持 44px 的觸控高度，業主：觸控目標要夠大）、標題字縮到幾倍。 */
export const BAR_COLLAPSE_PX = 64;
export const BAR_COMPACT_H = 44;
export const BAR_COMPACT_TITLE = 0.88;

/** 固定在頁面上方的功能列（篩選、搜尋…，Screen 的 top）下滑縮到幾倍（維持約 41px 的觸控高度）。 */
export const TOPROW_COMPACT_SCALE = 0.85;

/**
 * 固定在頁面上方的功能列（Screen 的 `top`：寰宇大學的篩選搜尋列等）也「下滑縮小」（業主 2026-11-24，超派模式所有頁面）：
 * 整列跟著捲動平順縮到 TOPROW_COMPACT_SCALE 倍（版面高度一起縮，內容往上靠），往上滑展開。只在超派模式（`collapseHeader`）。
 */
export function CollapseTopRow({ children }: { children: ReactNode }) {
  const on = useModeProfile().collapseHeader;
  const y = useBandScroll();
  const path = usePathname();
  const [h, setH] = useState(0);
  useEffect(() => resetBandScroll(), [path]);
  if (!on) return <>{children}</>;
  const p = Math.min(1, y / BAR_COLLAPSE_PX);
  const k = 1 - p * (1 - TOPROW_COMPACT_SCALE);
  return (
    <View style={h ? { height: Math.round(h * k), overflow: "visible" } : undefined}>
      <View onLayout={(e) => p === 0 && setH(Math.round(e.nativeEvent.layout.height))} style={p > 0 ? { width: `${100 / k}%`, transform: [{ scale: k }], transformOrigin: "top left" } : undefined}>
        {children}
      </View>
    </View>
  );
}

/**
 * 頁面大標題（Screen 的 `title`，主分頁：學習中、通知、設定…）下滑時「縮成固定的窄標題列」（業主 2026-11-24：每一頁都要下滑縮小）：
 * 大標題往上捲走的同時，一條 BAR_COMPACT_H 高的窄標題列（標題字 17）在上方淡入並固定住；往上滑回頂端再消失。只在超派模式（`collapseHeader`）。
 */
export function CompactTitleBar({ title, top, bg, border, color }: { title: string; top: number; bg: string; border: string; color: string }) {
  const on = useModeProfile().collapseHeader;
  const y = useBandScroll();
  if (!on) return null;
  const p = Math.min(1, Math.max(0, (y - 24) / 56));
  if (p <= 0) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, zIndex: 8, height: BAR_COMPACT_H + top, paddingTop: top, justifyContent: "center", paddingHorizontal: 20, backgroundColor: bg, borderBottomWidth: 1, borderBottomColor: border, opacity: p }}>
      <Text numberOfLines={1} accessibilityRole="header" style={{ color, fontSize: 17, fontWeight: "700" }}>
        {title}
      </Text>
    </View>
  );
}

/** 縮小的進度範圍：封面下緣＝展開高度 − 捲動量，直到窄橫幅高度（跟著手指 1:1，不是固定門檻）。 */
export const collapseRange = (full: number) => Math.max(1, full - (COMPACT_H + COMPACT_GAP));

export function CollapseBand({ children, enabled = true }: { children: ReactNode; /** false＝不縮（例如大螢幕左右分欄，封面在左欄、內容在右欄）。 */ enabled?: boolean }) {
  const y = useBandScroll();
  const [full, setFull] = useState(0); // 展開時的高度（只在沒縮時量）
  useEffect(() => resetBandScroll(), []);
  if (!enabled) return <View>{children}</View>;
  const range = collapseRange(full || 1);
  const shown = full ? Math.max(COMPACT_H, full - Math.min(y, range)) : undefined;
  const crop = full && shown ? (full - shown) / 2 : 0; // 縮小時往上移一半，維持置中（與 CenterHero 的輪播一樣）
  return (
    <View style={shown !== undefined ? { height: shown, overflow: "hidden" } : undefined}>
      <View onLayout={(e) => y === 0 && setFull(Math.round(e.nativeEvent.layout.height))} style={shown !== undefined ? { position: "absolute", left: 0, right: 0, top: 0, height: full, transform: [{ translateY: -crop }] } : undefined}>
        {children}
      </View>
    </View>
  );
}
