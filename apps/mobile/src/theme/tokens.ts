/**
 * 寰宇行動大學設計系統 tokens：所有顏色、間距、字級、圓角都從這裡取用，
 * 畫面中不要直接寫色碼或數字間距，避免各頁風格漂移。
 */
import { UI_SCALE } from "./ui-scale";
export type ColorScheme = "light" | "dark";

const palettes = {
  // 這份色值就是《寰宇生態系統一設計規範 2.0》的正本（業主 2026-11-16：全生態系改用行動大學實際使用的設計；docs/hglobal-color-standard.md、docs/hglobal-tokens.json 與它一致）；不要自行新增色碼。
  light: {
    background: "#F8F6EF",
    surface: "#FFFFFF",
    surfaceMuted: "#F0EEE3",
    border: "#E2DFD2",
    text: "#1D2A22",
    textMuted: "#5D6B62",
    textOnAccent: "#FFFFFF",
    accent: "#0C603C",
    accentSoft: "#E7F1EA",
    accentText: "#0C603C",
    warning: "#A86408",
    warningSoft: "#FDF0E3",
    danger: "#B3261E",
    dangerSoft: "#FBEAE8",
    success: "#1B7A43",
    successSoft: "#E7F1EA",
    tabBar: "#FFFFFF",
    // 底部分頁列（業主 2026-11-20 方案 1）：深綠實心底、白字，目前分頁是黃色膠囊。
    navBar: "#0C603C",
    navPill: "#F5C842",
    navPillText: "#1F1A00",
  },
  dark: {
    background: "#121515",
    surface: "#1C2020",
    surfaceMuted: "#252A29",
    border: "#343B38",
    text: "#EEEFEB",
    textMuted: "#A6ADAB",
    textOnAccent: "#FFFFFF",
    accent: "#2F8A5B",
    accentSoft: "#1D3226",
    accentText: "#5DB383",
    warning: "#F2C063",
    warningSoft: "#3A2E17",
    danger: "#F2B8B5",
    dangerSoft: "#3C1E1C",
    success: "#4FA774",
    successSoft: "#1B3022",
    tabBar: "#171B1B",
    navBar: "#14573A",
    navPill: "#F2C063",
    navPillText: "#1F1A00",
  },
} as const;

export type Palette = { [K in keyof (typeof palettes)["light"]]: string };
export const colors: Record<ColorScheme, Palette> = palettes;

/** 課程封面主題色（對應資料中的 course.theme）。 */
export const courseThemes: Record<
  string,
  { light: [string, string]; dark: [string, string] }
> = {
  sage: { light: ["#DCE8D2", "#47704F"], dark: ["#24362A", "#8CC4A0"] },
  rose: { light: ["#F3DCDD", "#8E4250"], dark: ["#3D2729", "#F0B7BE"] },
  gold: { light: ["#F3E6C4", "#7D5A12"], dark: ["#3B3220", "#EBCB7E"] },
  blue: { light: ["#D8E4F2", "#2F5687"], dark: ["#1F2D3D", "#A9C6EC"] },
  clay: { light: ["#EFDCCF", "#8A4B2A"], dark: ["#3A2A20", "#E8B595"] },
  violet: { light: ["#E3DCF1", "#5A4389"], dark: ["#2C2540", "#C8B7EE"] },
};

/** 固定格式文字封面的咖啡色系（業主 2026-11-19，銅章會議）：[底色, 文字色]。不在 courseThemes 的隨機色裡。 */
export const coverBronze: { light: [string, string]; dark: [string, string] } = { light: ["#6B4226", "#F7E7C6"], dark: ["#4A2E1B", "#F0D9A8"] };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const type = {
  display: { fontSize: 28, lineHeight: 36, fontWeight: "700" },
  title: { fontSize: 20, lineHeight: 28, fontWeight: "700" },
  headline: { fontSize: 17, lineHeight: 24, fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" },
  callout: { fontSize: 14, lineHeight: 20, fontWeight: "400" },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "500" },
} as const;
export type TypeVariant = keyof typeof type;

/** 觸控目標最小尺寸（Apple HIG 44pt / Material 48dp 取大者）。 */
export const minTouch = Math.round(48 * UI_SCALE);
/** 手機網頁內容最大寬度。平板、電腦的內容寬度、欄數、放大倍數見 theme/layout.ts 與 lib/tablet-scale.ts（2026-11-18）。 */
export const maxContentWidth = 720;

/** 底部分頁列與上方置頂標題列（返回＋分享）共用的高度：兩者永遠一樣高。 */
export const barHeight = Math.round(56 * UI_SCALE);
