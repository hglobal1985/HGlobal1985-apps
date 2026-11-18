import { Platform, type ViewStyle } from "react-native";

/**
 * 「淡化」效果的唯一來源（業主 2026-11-18）：黑白（只有網頁版）＋透明度 30%。
 * 清單區塊卡展開其他區塊時、以及內容是 0 的區塊，都用這一組，顏色才會一致。
 */
export const FADE_OPACITY = 0.3;
export const fadedStyle: ViewStyle[] = [{ opacity: FADE_OPACITY }, ...(Platform.OS === "web" ? [{ filter: "grayscale(1)" } as ViewStyle] : [])];
