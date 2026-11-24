import type { ReactNode } from "react";
import { useElderOn } from "./elder-mode";

/**
 * 使用模式設定檔（業主 2026-11-24：為了長期修改維護穩定，兩種模式的差異全部集中在這一個檔案）。
 *
 * 「至尊模式」（長輩大字簡易版）與「超派模式」（完整版）要顯示哪些分頁、哪些功能、用哪一種版面，
 * 一律寫在下面的 MODE_PROFILES，畫面只問「這個功能在目前模式開不開」（useFeature）或「目前用哪種版面」（useModeProfile），
 * 不可以在畫面裡自己寫「如果是至尊模式就…」。要調整某個模式隱藏／顯示什麼，只改這裡的 true／false。
 * 新增進階功能時：在 FeatureKey 加一個名字、兩個模式各填 true／false，元件入口用 useFeature 或 <ModeGate> 擋住。
 * 模式開關本身與字體倍數的儲存在 lib/elder-mode.ts；字體放大的套用在 lib/global-scale.ts。
 */

/** 可以依模式開關的功能。 */
export type FeatureKey =
  /** 加入我的清單（課程頁上方、清單列）。 */
  | "addToList"
  /** 課程頁留言板。 */
  | "comments"
  /** 學習成就（學習中頁上方的小樹苗徽章列）。 */
  | "achievements"
  /** 設定頁的「我的清單」入口。 */
  | "myLists"
  /** 設定頁的「我的書櫃」入口。 */
  | "library"
  /** 設定頁的「管理」區。 */
  | "manageSection"
  /** 課程頁管理員的「編輯」模式。 */
  | "adminEdit"
  /** 右下角「＋新增」浮動鈕（新增教材、課程、公告…）。 */
  | "addButton"
  /** 設定頁的「刪除帳號」鈕（業主 2026-11-24：至尊模式移除，超派模式仍有——上架商店規定 App 內要有刪除帳號入口）。 */
  | "deleteAccount";

/** 底部主選單的分頁（模式鍵固定在最右邊，不在這裡）。 */
export type TabKey = "home" | "courses" | "learning" | "notices" | "settings";

export type ModeProfile = {
  key: "elder" | "super";
  /** 模式名稱（主選單模式鍵的文字、提示文字）。 */
  name: string;
  /** 底部主選單要顯示的分頁（依序）。 */
  tabs: TabKey[];
  /** 首頁：voice＝大搜尋框＋大麥克風；classic＝原本的首頁。 */
  home: "voice" | "classic";
  /** 課程分頁：bigList＝大字課程清單；classic＝寰宇大學。 */
  courses: "bigList" | "classic";
  /** 課程頁：twoTabs＝上課／介紹兩頁；classic＝原本的課程頁。 */
  coursePage: "twoTabs" | "classic";
  /** 底部主選單放大（固定大小，不跟字體倍數）。 */
  bigNav: boolean;
  /** 頁面大標題（標題、未讀數、右側按鈕）上下堆疊，不橫擠（字放大後標題才不會被擠成一字一行）。 */
  stackHeaders: boolean;
  /** 字體可以自訂、可以跟著手機字體。 */
  fontAdjustable: boolean;
  /** 離開這個模式前要先確認（防誤按）。 */
  confirmLeave: boolean;
  /** 上拉選單的呈現方式：sheet＝從下方拉出的面板；page＝整頁顯示（至尊模式一律禁止上拉選單，業主 2026-11-24）。 */
  sheets: "sheet" | "page";
  /** 按模式鍵：page＝進入整頁的模式頁（/mode）；switch＝直接切到另一個模式。 */
  modeKey: "page" | "switch";
  features: Record<FeatureKey, boolean>;
};

export const MODE_PROFILES: Record<ModeProfile["key"], ModeProfile> = {
  // 至尊模式（業主 2026-11-24，B 方案）：長輩大字簡易版。
  elder: {
    key: "elder",
    name: "至尊",
    tabs: ["home", "courses", "learning", "notices"],
    home: "voice",
    courses: "bigList",
    coursePage: "twoTabs",
    bigNav: true,
    stackHeaders: true,
    fontAdjustable: true,
    confirmLeave: true,
    sheets: "page",
    modeKey: "page",
    features: { addToList: false, comments: false, achievements: false, myLists: false, library: false, manageSection: false, adminEdit: false, addButton: false, deleteAccount: false },
  },
  // 超派模式：原本的完整版。
  super: {
    key: "super",
    name: "超派",
    tabs: ["home", "courses", "learning", "notices", "settings"],
    home: "classic",
    courses: "classic",
    coursePage: "classic",
    bigNav: false,
    stackHeaders: false,
    fontAdjustable: false,
    confirmLeave: false,
    sheets: "sheet",
    modeKey: "switch",
    features: { addToList: true, comments: true, achievements: true, myLists: true, library: true, manageSection: true, adminEdit: true, addButton: true, deleteAccount: true },
  },
};

/** 目前模式的設定檔。 */
export function useModeProfile(): ModeProfile {
  return MODE_PROFILES[useElderOn() ? "elder" : "super"];
}

/** 這個功能在目前模式有沒有開。 */
export function useFeature(key: FeatureKey): boolean {
  return useModeProfile().features[key];
}

/** 包住某個功能：目前模式沒開就不顯示（元件也不會掛載、不會抓資料）。 */
export function ModeGate({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  return useFeature(feature) ? <>{children}</> : null;
}
