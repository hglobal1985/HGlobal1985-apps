import { useWindowDimensions } from "react-native";

/**
 * 大螢幕版面規則（杜杜龍 2026-11-18：平板、電腦不可直接套用手機版面，全站統一從這裡取）。
 *
 * 依「目前可用的畫面寬度」分三級（平板的字體、圖示、按鈕由 theme/ui-scale.ts 放大）：
 * - compact（< 600）：手機。版面完全維持原本的手機設計。
 * - medium（600～899）：平板直式、小視窗。內容放寬、清單變兩欄。
 * - expanded（≥ 900）：平板橫式、電腦。內容更寬、格狀清單更多欄、課程頁改成左右兩欄（左影片、右章節）。
 *
 * 要調寬度、欄數、留白只改這個檔案，全站一起變。新頁面一律用 Screen（會自動套用），自己排格狀或兩欄時用 useLayout()。
 */
export type SizeClass = "compact" | "medium" | "expanded";
export const MEDIUM_MIN = 600;
export const EXPANDED_MIN = 900;

export function sizeClassOf(width: number): SizeClass {
  return width >= EXPANDED_MIN ? "expanded" : width >= MEDIUM_MIN ? "medium" : "compact";
}

export type Layout = {
  width: number;
  height: number;
  size: SizeClass;
  /** 平板或電腦（不是手機寬度）。 */
  large: boolean;
  landscape: boolean;
  /** 頁面左右留白。 */
  gutter: number;
  /** 文字、清單、表單類頁面的內容最大寬度（設定、通知、報名明細、後台…）：一行不會長到難讀。 */
  readMax: number;
  /** 圖片、卡片類頁面的內容最大寬度（首頁、寰宇大學、學習中、系列、成就）：盡量用滿大螢幕。 */
  wideMax: number;
  /** 上拉面板（BottomSheet／EditSheet）的最大寬度；手機＝滿版（undefined）。 */
  sheetMax: number | undefined;
  /** 課程資訊卡（CourseCard）一列幾張。 */
  cardCols: number;
  /** 課程頁改成左右兩欄（左：影片／EDM＋控制列，右：章節與內容）。 */
  split: boolean;
};


export function layoutOf(width: number, height: number): Layout {
  const size = sizeClassOf(width);
  const landscape = width > height;
  const compact = size === "compact";
  return {
    width,
    height,
    size,
    large: !compact,
    landscape,
    gutter: compact ? 16 : size === "medium" ? 24 : 32,
    readMax: compact ? 720 : size === "medium" ? 760 : 880,
    wideMax: compact ? 720 : size === "medium" ? 960 : 1280,
    sheetMax: compact ? undefined : 680,
    cardCols: compact ? 1 : size === "medium" ? 2 : width >= 1180 ? 3 : 2,
    split: size === "expanded" && landscape,
  };
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  return layoutOf(width, height);
}

/** 16:9 系列小卡、中心卡一列幾張（依格子實際寬度）：手機 2～3 張，平板 3～4 張，電腦 4～6 張。 */
export function tileColumns(boxW: number): number {
  return boxW >= 1180 ? 5 : boxW >= 860 ? 4 : boxW >= 520 ? 3 : 2;
}

/** 直式（3:4）EDM 小卡一列幾張（中心頁）：手機 3 張，大螢幕依寬度增加。 */
export function portraitColumns(boxW: number): number {
  return boxW >= 1180 ? 6 : boxW >= 860 ? 5 : boxW >= 620 ? 4 : 3;
}
