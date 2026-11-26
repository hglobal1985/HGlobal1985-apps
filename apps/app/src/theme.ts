/**
 * 顏色、字級、尺寸：中央《H-Global1985 視覺規範》（亮色＝第 1 節、深色＝第 1.5 節）。
 * 畫面不要直接寫色碼；需要新顏色先問業主。
 */
import { useColorScheme } from "react-native";

const light = {
  bg: "#f8f6ef",
  card: "#ffffff",
  fg: "#1d2a22",
  muted: "#5d6b62",
  line: "#e2dfd2",
  green: "#0c603c",
  greenDark: "#094a2e",
  greenSoft: "#e7f1ea",
  orange: "#cc6c0c",
  orangeSoft: "#fdf0e3",
  yellow: "#f2dc27",
  danger: "#b3261e",
  dangerSoft: "#fbeae8",
  ok: "#1b7a43",
  warn: "#a86408",
  on: "#ffffff",
  bWarn: "#e6c48c",
  bBad: "#e8b4af",
  chk: "#9aa89f",
  shadow: "rgba(29,42,34,0.08)",
  dim: "rgba(0,0,0,0.55)",
};
export type Palette = typeof light;
const dark: Palette = {
  bg: "#121515",
  card: "#1c2020",
  fg: "#eeefeb",
  muted: "#a6adab",
  line: "#343b38",
  green: "#cee49f",
  greenDark: "#e6f3c4",
  greenSoft: "#2c3622",
  orange: "#f0a050",
  orangeSoft: "#3a2e17",
  yellow: "#f2dc27",
  danger: "#f2b8b5",
  dangerSoft: "#3c1e1c",
  ok: "#9bd39e",
  warn: "#f2c063",
  on: "#172016",
  bWarn: "#6b5424",
  bBad: "#7a3b37",
  chk: "#7b8581",
  shadow: "rgba(0,0,0,0.45)",
  dim: "rgba(0,0,0,0.65)",
};

export function useColors(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export const size = { touch: 44, radius: 10, card: 16, gap: 14, pageMax: 680 };
export const font = {
  page: { fontSize: 22, fontWeight: "700" as const },
  title: { fontSize: 18, fontWeight: "700" as const },
  body: { fontSize: 16, lineHeight: 26 },
  small: { fontSize: 14, lineHeight: 21 },
  tiny: { fontSize: 13, lineHeight: 18 },
};
