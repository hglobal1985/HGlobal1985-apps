import { useIsFocused } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { setBandExtra } from "./band-extra";
import { getBandRect, setBandRect } from "./band-rect";
import { resetBandScroll, scrollBandTop, useBandScroll } from "./band-scroll";
import { MiniWindow } from "./mini-window";

/**
 * 「封面區」下滑縮成迷你播放器的模組（杜杜龍 2026-11-24 永久指示：影片播放區和封面區都要，超派、至尊、App、網頁同一份）。
 * 設計＝課程頁影片播放時的迷你播放器（features/player）：頁面往下滑，上方釘住的區塊平順縮矮到不見（內容第一列往上補），
 * 同時右下角（底部選單上方）浮出一個迷你小視窗（同樣的流光邊框、同樣的寬度、16:9），點一下回到頂端、封面展開；往上滑回頂端再還原。
 * 有影片在播放時，由全站播放器（features/player，SHRINK_PX＝140）縮成浮動迷你播放器，不走這裡。
 *
 * 用法：兩個元件成對——`CollapseBand`（包住釘在上方的封面）＋`CoverMiniFloat`（放在頁面最外層、傳入迷你畫面要顯示的封面）。
 * 數字（縮放範圍、迷你寬度）只在這個檔案定義。
 */
/** 頁面往下滑多少像素，封面就完全縮成迷你（同影片的 SHRINK_PX）。 */
export const MINI_PX = 140;
export const miniProgress = (y: number, range = MINI_PX) => Math.min(1, Math.max(0, y / range));

export function CollapseBand({ children, enabled = true, shrink = true, range = MINI_PX }: { children: ReactNode; /** false＝不縮（例如大螢幕左右分欄，封面在左欄、內容在右欄）。 */ enabled?: boolean; /** false＝封面自己負責縮矮（中心頁、系列頁的 hero 隨捲動縮放），這裡只量位置、縮小途中隱藏本體讓小視窗畫變形框。 */ shrink?: boolean; /** 往下滑多少像素算縮完（預設 MINI_PX；hero 的縮放範圍＝展開高度）。 */ range?: number }) {
  const y = useBandScroll();
  const [full, setFull] = useState(0); // 展開時的高度（只在沒縮時量）
  const box = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any;
  useEffect(() => resetBandScroll(), []);
  useEffect(() => () => setBandRect(null), []);
  // 登記需要的額外捲動空間：封面縮完＝捲動區多出 full，可捲範圍會跟著少 full（內容短的頁面也要捲得到縮完；見 band-extra.ts）。
  useEffect(() => {
    if (!enabled || !full) return;
    setBandExtra(range + full + 24);
    return () => setBandExtra(0);
  }, [enabled, full, range]);
  if (!enabled) return <View>{children}</View>;
  const p = miniProgress(y, range);
  const shown = full ? Math.round(full * (1 - p)) : undefined;
  return (
    <View style={shrink && shown !== undefined && p > 0 ? { height: shown, overflow: "hidden" } : undefined}>
      {/* 縮小途中封面本體隱藏，由小視窗那邊畫「大邊框由大到小」的變形框（與影片縮小一致，MiniWindow 的 morph） */}
      <View
        ref={box}
        style={p > 0.02 && getBandRect() ? { opacity: 0 } : undefined}
        onLayout={(e) => {
          if (p !== 0) return;
          setFull(Math.round(e.nativeEvent.layout.height));
          box.current?.measureInWindow((x: number, y: number, w: number, h: number) => w > 0 && h > 0 && setBandRect({ x, y, w, h }));
        }}
      >
        {children}
      </View>
    </View>
  );
}

/**
 * 跟著封面一起縮掉的「待機控制列」（播放鈕＋時間軸＋倒數時間；杜杜龍 2026-11-26：下滑封面縮成迷你／圓球之後，時間軸也要跟著隱藏，全站統一）。
 * 用法：包住釘在封面下方的控制列（LessonStage 的待機控制列）；進度與 `CollapseBand` 完全同步（同一個捲動位移、同一個 range），
 * 封面縮多少、它就縮多少，縮完高度 0＝整條不見，回到頂端自動還原。影片播放中的控制列（PlayerControls）本來就包在播放區塊裡、跟著影片縮掉，不走這裡。
 * 不登記額外的捲動空間、不量封面位置，所以不會和 CollapseBand 打架。
 */
export function CollapseFollow({ children, enabled = true, range = MINI_PX }: { children: ReactNode; enabled?: boolean; range?: number }) {
  const y = useBandScroll();
  const [full, setFull] = useState(0);
  if (!enabled) return <View>{children}</View>;
  const p = miniProgress(y, range);
  return (
    <View style={full && p > 0 ? { height: Math.round(full * (1 - p)), overflow: "hidden" } : undefined}>
      <View
        onLayout={(e) => {
          if (p === 0) setFull(Math.round(e.nativeEvent.layout.height)); // 只在沒縮時量展開高度
        }}
      >
        {children}
      </View>
    </View>
  );
}

/**
 * 封面縮成的迷你小視窗（成對的 CollapseBand 把封面縮掉之後，右下角浮出它）：放在頁面最外層。cover＝小視窗與小圓圖裡顯示的封面（填滿）。
 * 一浮出就是最小的圓球（點一下才展開成小視窗；影片播放時則是有紅綠燈按鈕的迷你播放器，見 features/player）。
 * 與影片迷你小視窗一模一樣的規格與功能（ui/mini-spec.ts、ui/mini-window.tsx）：黃＝最小化（小圓圖）、綠＝最大化（回到頂端、封面展開）、紅＝關閉（這次先不再浮出，回到頂端再往下滑才會再出現），可任意拖曳、位置記在本機。
 * enabled＝false（例如影片在播放、大螢幕分欄）不顯示。
 */
export function CoverMiniFloat({ cover, enabled = true, label, range = MINI_PX }: { cover: ReactNode; enabled?: boolean; label: string; /** 縮完要滑多少像素（要和成對的 CollapseBand 一致；預設 MINI_PX）。 */ range?: number }) {
  const y = useBandScroll();
  const focused = useIsFocused(); // 堆在後面、沒在看的頁面不出圓球
  const [closed, setClosed] = useState(false);
  // 靜態封面往下滑：一浮出就直接縮到最小的圓球（杜杜龍 2026-11-25）；點圓球才展開成小視窗，回到頂端再往下滑又從圓球開始。
  const [collapsed, setCollapsed] = useState(true);
  const p = miniProgress(y, range);
  useEffect(() => {
    if (p <= 0.02) {
      setClosed(false); // 回到頂端就恢復，下次往下滑再浮出
      setCollapsed(true);
    }
  }, [p]);
  if (!enabled) return null;
  return (
    <MiniWindow
      visible={focused && p > 0.02 && !closed}
      morph={{ p, from: getBandRect() }}
      windowContent={cover}
      circleContent={cover}
      label={label}
      maximizeLabel="最大化（回到頂端、封面展開）"
      onMaximize={scrollBandTop}
      onClose={() => setClosed(true)}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
    />
  );
}
