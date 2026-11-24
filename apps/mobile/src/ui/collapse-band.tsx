import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { setBandExtra } from "./band-extra";
import { resetBandScroll, scrollBandTop, useBandScroll } from "./band-scroll";
import { MiniWindow } from "./mini-window";

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
 * 封面縮成的迷你小視窗（成對的 CollapseBand 把封面縮掉之後，右下角浮出它）：放在頁面最外層。cover＝小視窗與小圓圖裡顯示的封面（填滿）。
 * 與影片迷你小視窗一模一樣的規格與功能（ui/mini-spec.ts、ui/mini-window.tsx）：黃＝最小化（小圓圖）、綠＝最大化（回到頂端、封面展開）、紅＝關閉（這次先不再浮出，回到頂端再往下滑才會再出現），可任意拖曳、位置記在本機。
 * enabled＝false（例如影片在播放、大螢幕分欄）不顯示。
 */
export function CoverMiniFloat({ cover, enabled = true, label }: { cover: ReactNode; enabled?: boolean; label: string }) {
  const y = useBandScroll();
  const [closed, setClosed] = useState(false);
  const p = miniProgress(y);
  useEffect(() => {
    if (p <= 0.02) setClosed(false); // 回到頂端就恢復，下次往下滑再浮出
  }, [p]);
  if (!enabled) return null;
  return (
    <MiniWindow
      visible={p > 0.02 && !closed}
      opacity={Math.min(1, p * 2)}
      windowContent={cover}
      circleContent={cover}
      label={label}
      maximizeLabel="最大化（回到頂端、封面展開）"
      onMaximize={scrollBandTop}
      onClose={() => setClosed(true)}
    />
  );
}
