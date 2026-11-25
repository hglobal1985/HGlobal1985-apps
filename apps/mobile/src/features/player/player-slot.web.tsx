import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, type ElementRef } from "react";
import type { View } from "react-native";
import { setBandExtra } from "@/ui/band-extra";
import { StageFrame } from "@/ui/stage-frame";
import { SHRINK_PX } from "./shrink";
import { engine } from "./engine.web";

/**
 * 課程頁釘在上方的影片區塊（Web）：只是一個佔位的 16:9 黑色舞台，把位置告訴全站播放器；
 * 真正的 <video>／iframe 由 PlayerLayer 疊在這個位置上，所以離開頁面不會被銷毀。
 */
export function PlayerSlot({ trackKey }: { trackKey: string }) {
  const ref = useRef<ElementRef<typeof View>>(null);
  // 只有這一頁「正在畫面上」才算內嵌；切到別頁時（上一頁仍留在背景）就交給浮動小視窗。
  useFocusEffect(
    useCallback(() => {
      engine.setSlot(trackKey, ref.current as unknown as HTMLElement);
      return () => engine.clearSlot(trackKey);
    }, [trackKey]),
  );
  // 頁面太短捲不到「縮完」時，縮矮舞台會讓可捲範圍變小、捲動位置被夾回去 → 又展開 → 又縮（影片一直抖動，業主 2026-11-25 錄影回報）。
  // 登記額外的捲動空間（同 CollapseBand），保證一定捲得夠、縮完之後穩定停住。
  useEffect(() => {
    const measure = () => {
      const el = ref.current as unknown as HTMLElement | null;
      const band = el?.parentElement;
      // 縮矮時 band 高度被改小，舞台本身高度不變（舞台＝16:9 寬度算出來的）
      const h = el ? el.offsetHeight : 0;
      if (h > 0 && band) setBandExtra(SHRINK_PX + h + 24);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      setBandExtra(0);
    };
  }, []);
  return <StageFrame ref={ref} />;
}
