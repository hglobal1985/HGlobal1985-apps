import type { ReactNode } from "react";
import { Platform, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";

/**
 * 「背景暗化＋輕微模糊」模組（業主 2026-11-17）：所有蓋在頁面上的彈出層（全螢幕文字提醒、上拉面板、照片放大、個人資料視窗、新增教材選單…）
 * 共用這一組定義。要調整暗的程度、模糊程度，只改下面兩個數字，全站一起變；新增任何彈出層的背景也用 DimBackdrop 或 dimStyle，不要另寫。
 * 網頁版有背景模糊；iOS／Android 先只有暗化（模糊要等上架前補，需要原生模組）。
 */
/** 暗化的黑色透明度（0～1）。原本約 0.5，業主 2026-11-17 要求再加深 50%＝0.75。 */
export const DIM_ALPHA = 0.75;
/** 背景模糊程度（px，只有網頁版）。 */
export const DIM_BLUR = 3;
export const DIM_COLOR = `rgba(0,0,0,${DIM_ALPHA})`;

/** 暗化＋模糊的樣式，直接放進任何 style。 */
export const dimStyle = (Platform.OS === "web"
  ? { backgroundColor: DIM_COLOR, backdropFilter: `blur(${DIM_BLUR}px)`, WebkitBackdropFilter: `blur(${DIM_BLUR}px)` }
  : { backgroundColor: DIM_COLOR }) as ViewStyle;

/** 暗化＋模糊的背景層（預設填滿父層）。 */
export function DimBackdrop({ style, children, ...rest }: ViewProps & { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  return (
    <View {...rest} style={[dimStyle, style]}>
      {children}
    </View>
  );
}
