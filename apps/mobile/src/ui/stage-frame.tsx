import { createContext, forwardRef, useContext, type ElementRef, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useLayout } from "@/theme/layout";

/**
 * 舞台最大寬度：預設＝手機 720、大螢幕用閱讀寬度（theme/layout.ts 的 readMax）；
 * 課程頁大螢幕左右兩欄時，左欄用 StageWidth.Provider value={null} 讓舞台填滿左欄（杜杜龍 2026-11-18）。
 */
export const StageWidth = createContext<number | null | undefined>(undefined);

/** 舞台與播放控制列共用的最大寬度（undefined＝填滿外框）。 */
export function useStageMax(): number | undefined {
  const ctx = useContext(StageWidth);
  const { readMax } = useLayout();
  if (ctx === null) return undefined;
  return ctx ?? readMax;
}

/**
 * 課程頁上方「舞台」：黑底滿版、中間是 16:9（最寬見 useStageMax）。
 * 影片／YouTube 播放區與課程介紹頁的 EDM 區都用它，所以兩頁上方的高度永遠一模一樣，
 * 底下的內容不會因為切換頁面而上下跳動。要改高度或比例，只改這裡。
 */
export const StageFrame = forwardRef<ElementRef<typeof View>, { children?: ReactNode }>(function StageFrame({ children }, ref) {
  const maxWidth = useStageMax();
  return (
    <View style={styles.band}>
      <View ref={ref} style={[styles.inner, { maxWidth }]}>
        {children}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  band: { backgroundColor: "#000", alignItems: "center" },
  inner: { width: "100%", aspectRatio: 16 / 9, overflow: "hidden" },
});
