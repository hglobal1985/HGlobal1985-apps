import { useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, useWindowDimensions, View } from "react-native";
import { setBandExtra } from "./band-extra";
import { resetBandScroll, scrollBandTop, useBandScroll } from "./band-scroll";
import { GradientFrame } from "./gradient-frame";
import { space } from "@/theme/tokens";

/**
 * 「封面區」下滑縮成迷你播放器的模組（業主 2026-11-24 永久指示：影片播放區和封面區都要，超派、至尊、App、網頁同一份）。
 * 設計＝課程頁影片播放時的迷你播放器（features/player）：頁面往下滑，上方釘住的區塊平順縮矮到不見（內容第一列往上補），
 * 同時右下角（底部選單上方）浮出一個迷你小視窗（同樣的流光邊框、同樣的寬度、16:9），點一下回到頂端、封面展開；往上滑回頂端再還原。
 * 有影片在播放時，由全站播放器（features/player，SHRINK_PX＝140）縮成浮動迷你播放器，不走這裡。
 *
 * 用法：兩個元件成對——`CollapseBand`（包住釘在上方的封面）＋`CoverMiniFloat`（放在頁面最外層、傳入迷你畫面要顯示的封面）。
 * 數字（縮放範圍、迷你寬度）只在這個檔案定義。
 */
/** 頁面往下滑多少像素，封面就完全縮成迷你（同影片的 SHRINK_PX）。 */
export const MINI_PX = 140;
export const miniProgress = (y: number) => Math.min(1, Math.max(0, y / MINI_PX));
/** 迷你小視窗寬度（同影片迷你播放器的 floatWidth）。 */
export const miniWidth = (winW: number) => Math.round(Math.min(240, Math.max(180, winW * 0.55)));

/** 中心頁、系列頁封面（CenterHero）縮成窄橫幅用的數字（方案 D，業主 2026-11-16）；只在這裡定義。 */
export const COMPACT_H = 112;
export const COMPACT_SIDE = 16;
/** 縮成窄橫幅時，封面上下留白合計（上 8＋下 4）。 */
export const COMPACT_GAP = space.sm + space.xs;

export function CollapseBand({ children, enabled = true }: { children: ReactNode; /** false＝不縮（例如大螢幕左右分欄，封面在左欄、內容在右欄）。 */ enabled?: boolean }) {
  const y = useBandScroll();
  const [full, setFull] = useState(0); // 展開時的高度（只在沒縮時量）
  useEffect(() => resetBandScroll(), []);
  // 登記需要的額外捲動空間：封面縮完＝捲動區多出 full，可捲範圍會跟著少 full（內容短的頁面也要捲得到縮完；見 band-extra.ts）。
  useEffect(() => {
    if (!enabled || !full) return;
    setBandExtra(MINI_PX + full + 24);
    return () => setBandExtra(0);
  }, [enabled, full]);
  if (!enabled) return <View>{children}</View>;
  const p = miniProgress(y);
  const shown = full ? Math.round(full * (1 - p)) : undefined;
  return (
    <View style={shown !== undefined && p > 0 ? { height: shown, overflow: "hidden" } : undefined}>
      <View onLayout={(e) => p === 0 && setFull(Math.round(e.nativeEvent.layout.height))}>{children}</View>
    </View>
  );
}

/**
 * 封面縮成的迷你小視窗：放在頁面最外層（position: absolute，右下角、底部選單上方）。cover＝小視窗裡顯示的封面（填滿）。
 * 往下滑時淡入並放大（0.7 → 1）、有流光邊框；點一下回到頂端。enabled＝false（例如影片在播放、大螢幕分欄）不顯示。
 */
export function CoverMiniFloat({ cover, enabled = true, label }: { cover: ReactNode; enabled?: boolean; label: string }) {
  const y = useBandScroll();
  const { width: winW } = useWindowDimensions();
  if (!enabled) return null;
  const p = miniProgress(y);
  if (p <= 0.02) return null;
  const mw = miniWidth(winW);
  const mh = Math.round((mw * 9) / 16);
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", right: 12, bottom: 12, zIndex: 30, opacity: p, transform: [{ scale: 0.7 + 0.3 * p }, { translateY: (1 - p) * 24 }] }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}，點一下回到頂端`} onPress={scrollBandTop} style={Platform.OS === "web" ? ({ cursor: "pointer" } as object) : undefined}>
        <GradientFrame width={mw} height={mh + 9} radius={14}>
          <View style={{ width: "100%", height: "100%", overflow: "hidden" }}>{cover}</View>
        </GradientFrame>
      </Pressable>
    </View>
  );
}
