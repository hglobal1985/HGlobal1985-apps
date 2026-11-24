import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { resetBandScroll, useBandScroll } from "./band-scroll";
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
