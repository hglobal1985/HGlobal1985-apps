/** 前後端共用的資料格式：統計分析、關鍵字管理、我的書櫃（杜杜龍 2026-11-27 從 contract.ts 依功能拆出；contract.ts 會全部轉出，舊的 import 不用改）。 */
import type { AttachmentType } from "./media-misc.ts";

// ---------- 統計分析（Mux）----------
export type StatBlock = {
  id: string;
  title: string;
  /** core＝最常用、more＝次要、advanced＝進階（排在最後）。 */
  level: "core" | "more" | "advanced";
  note?: string;
  /** 讀不到時的原因（其他區塊不受影響）。 */
  error?: string;
  stats?: { label: string; value: string; sub?: string }[];
  bars?: { label: string; value: number; max: number; text: string }[];
  head?: string[];
  rows?: string[][];
};
export type MuxStats = { generatedAt: string; freeMinutes: number; blocks: StatBlock[] };

// ---------- 關鍵字管理（超級管理員）----------
export type KeywordKind = "category" | "series" | "location";
export type KeywordItem = { value: string; count: number; preset: boolean; edmUrl?: string | null };
export type KeywordLists = Record<KeywordKind, KeywordItem[]>;
export const KEYWORD_INFO: Record<KeywordKind, { title: string; hint: string }> = {
  category: { title: "分類", hint: "課程的分類，例如：達標班、會議" },
  series: { title: "系列", hint: "同系列的課，全部課程清單只顯示最近的一場" },
  location: { title: "場地", hint: "課程的上課地點" },
};

// ---------- 我的書櫃（杜杜龍 2026-11-17） ----------
export type LibraryItemType = "shelf" | "book";
/** 書櫃裡的一格：shelf＝書架（分類標題，可收合）、book＝一本書（影片、簡報、PDF、連結）。locked＝這本書有密碼且尚未解鎖（沒有 url）。 */
export type LibraryItem = {
  id: string;
  kind: LibraryItemType;
  title: string;
  url: string | null;
  type: AttachmentType | null;
  eventDate: string | null;
  start: number | null;
  end: number | null;
  locked: boolean;
  /** 只有擁有者看得到：這本書有沒有設密碼、幾時失效。 */
  pwSet?: boolean;
  pwExpiresAt?: string | null;
  pwExpired?: boolean;
};
/** 集滿這麼多枚徽章就自動解鎖書櫃鑰匙（杜杜龍 2026-11-17）。 */
export const LIBRARY_KEY_BADGES = 100;
export type LibraryMine = { keys?: { have: number; need: number; blocked?: string }; library: null | { number: string; title: string; ownerName: string; views: number; pwSet: boolean; pwExpiresAt: string | null; pwExpired: boolean }; items: LibraryItem[] };
/** 公開檢視：locked＝整座書櫃要先輸入密碼（items 是空的）；owner＝正在看自己的書櫃。 */
export type LibraryView = { number: string; title: string; ownerName: string; locked: boolean; lockExpired: boolean; owner: boolean; items: LibraryItem[] };
export type LibraryUnlock = { token: string; until: number };

/**
 * 我的清單封面的漸層底色（杜杜龍 2026-11-22：會員不能上傳封面圖，只能選管理員的底圖或下面這些漸層）。
 * 10 種不同風格、白色粗體字疊上去都清楚；`hex`（起始色）是儲存用的代號（沿用舊的單色代號），`to` 是漸層終點色，由左上往右下 135 度。
 * 第一個是網站深綠（預設）。要增減或調色只改這一張表（前後端共用）。
 */
export const LIST_COVER_COLORS: { hex: string; to: string; name: string }[] = [
  { hex: "#0C603C", to: "#3FA66B", name: "森林綠" },
  { hex: "#1F4E79", to: "#4A90C2", name: "深海藍" },
  { hex: "#8E2A3A", to: "#D4586A", name: "酒紅" },
  { hex: "#B7791F", to: "#E0A62E", name: "琥珀金" },
  { hex: "#6B4FA0", to: "#B08CE0", name: "薰衣草紫" },
  { hex: "#6B4A2F", to: "#B5835A", name: "咖啡棕" },
  { hex: "#D4623A", to: "#F28C4E", name: "珊瑚橘" },
  { hex: "#2B2B2E", to: "#6B6F78", name: "墨黑" },
  { hex: "#C2517A", to: "#E57AA0", name: "玫瑰粉" },
  { hex: "#137C83", to: "#3FB5AE", name: "湖水青" },
];

/** 網站暫時無法服務（部署更新、系統錯誤、會員中心連不上、維護中…）時，全站統一顯示的白話提示（杜杜龍 2026-11-24 改文字）。後端、App 都用這一句。 */
export const UPGRADING_MSG = "網站功能正在升級中、請稍候再試";
