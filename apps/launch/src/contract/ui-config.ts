/** 前後端共用的資料格式：畫面設定（課程排序、緞帶、分享、App 設定）（杜杜龍 2026-11-27 從 contract.ts 依功能拆出；contract.ts 會全部轉出，舊的 import 不用改）。 */

// ---------- 畫面設定（課程排序與緞帶）----------
/** 緞帶可選的顏色：只能用《寰宇生態系固定配色規範》的色（色碼在 App 端的 ribbon 色表）。 */
export const RIBBON_PALETTE = ["green", "greenDark", "olive", "orange", "warn", "yellow", "salmon", "danger", "ok", "muted"] as const;
export type RibbonColor = (typeof RIBBON_PALETTE)[number];

/** 課程卡片的緞帶狀態。left＝左上角（資格或狀態）、right＝右上角（日期倒數）。 */
export const RIBBON_KEYS = ["public_free", "learning", "completed", "pending", "can_register", "ineligible", "price_tba", "countdown", "in_progress", "ended"] as const;
export type RibbonKey = (typeof RIBBON_KEYS)[number];
export const RIBBON_INFO: Record<RibbonKey, { title: string; side: "left" | "right"; hint: string }> = {
  public_free: { title: "免費公開", side: "left", hint: "訪客看到完全公開的課程" },
  learning: { title: "學習中", side: "left", hint: "已報名開通、還沒學完" },
  completed: { title: "已聽完", side: "left", hint: "已報名開通、全部章節都完成" },
  pending: { title: "報名審核中", side: "left", hint: "已送出報名、等待窗口審核" },
  can_register: { title: "可以報名", side: "left", hint: "符合資格、尚未報名、開放報名" },
  ineligible: { title: "獎銜不符", side: "left", hint: "登入會員但獎銜不符合報名資格" },
  price_tba: { title: "費用尚未公布", side: "left", hint: "勾選「尚未公布」的課程" },
  countdown: { title: "倒數天數", side: "right", hint: "活動還沒開始；文字裡的 {n} 會換成天數" },
  in_progress: { title: "活動進行中", side: "right", hint: "今天正在活動日期範圍內" },
  ended: { title: "活動已結束", side: "right", hint: "活動日期已過" },
};

/** 「全部課程」的排序分組（由上到下就是優先順序）。每組內：未開課依日期由近到遠，已開課依日期由新到舊。 */
export const SORT_GROUPS = ["pending", "eligible_upcoming", "eligible_tba", "eligible_started", "public_free", "enrolled", "ineligible_upcoming", "ineligible_started"] as const;
export type SortGroup = (typeof SORT_GROUPS)[number];
export const SORT_GROUP_INFO: Record<SortGroup, { title: string; hint: string }> = {
  pending: { title: "報名審核中的課程", hint: "已送出報名、等待審核" },
  eligible_upcoming: { title: "符合資格、尚未報名・尚未開課", hint: "活動日期還沒到" },
  eligible_tba: { title: "符合資格、尚未報名・費用尚未公布", hint: "活動日期還沒到、費用還沒公布" },
  eligible_started: { title: "符合資格、尚未報名・已開課", hint: "已經開始或沒有日期" },
  public_free: { title: "公開免費的課程", hint: "完全公開、不用報名" },
  enrolled: { title: "已報名的課程", hint: "已開通（學習中、已聽完）" },
  ineligible_upcoming: { title: "不符合資格・尚未開課", hint: "獎銜不符、活動日期還沒到" },
  ineligible_started: { title: "不符合資格・已開課", hint: "獎銜不符、已開始或沒有日期" },
};

export type UiConfig = {
  sortGroups: SortGroup[];
  /** 「全部課程 > 系列」小卡的手動排序：由上到下的小卡代碼（系列＝s:系列名稱、單一課程＝c:課程編號）；沒列到的排在後面。 */
  seriesOrder: string[];
  /** 「相簿」專區大類別的由上到下順序（超級管理員在相簿側邊欄調整；代碼 edm／cover／series／course／block；沒列到的接在後面）。子項目一律按張數多到少，不能移動。 */
  albumOrder: string[];
  ribbons: Record<RibbonKey, { label: string; color: RibbonColor; enabled: boolean }>;
  /** 除了超級管理員、總部秘書之外，哪些職務可以看「統計分析」（職務代碼：president、sound、course、reviewer）。 */
  statsRoles: string[];
  /** APP 數值設定（超級管理員在「設定 > APP 數值設定」調整）：首頁推薦規則、輪播秒數、其他全站數值。 */
  app: AppSettings;
  /** 分享預設值（超級管理員在「設定 > 分享預設值」調整）：分享選單的文字、LINE 預覽卡片的標題與備註格式。 */
  share: ShareSettings;
};

/**
 * 分享預設值（杜杜龍 2026-11-16）：
 * - 分享選單送出的文字：一般（中心、分類、系列…）用 inviteText；單堂課程用 courseText（可用 {主講人}、{課程名稱}）；最後接 linkLead 與網址。
 * - LINE 等分享預覽卡片：標題＝「名稱＋titleSeparator＋siteName」；備註＝「addressIcon 地址」換行再接一句隨機學習金句（可各自關閉）。
 *   單堂課程的預覽卡片與它主辦的中心一致（標題、備註都用該中心的）；總部主辦的課程用 hqName，沒有地址。
 */
/** 報名與營收報表（設定 > 報名與營收報表）。 */
export type ReportBy = "center" | "course" | "month";
export type ReportRow = { key: string; label: string; registrations: number; opened: number; pending: number; rejected: number; free: number; amountTwd: number };
export type RegistrationReport = { from: string; to: string; by: ReportBy; rows: ReportRow[]; total: ReportRow };

/** 課程審核窗口可以指定的身份：主辦中心的會長、音控、小編。 */
export const REVIEW_ROLES = ["president", "sound", "editor"] as const;
export type ReviewRole = (typeof REVIEW_ROLES)[number];
export const REVIEW_ROLE_LABEL: Record<ReviewRole, string> = { president: "會長", sound: "音控", editor: "小編" };
/** 課程「費用與審核」頁的審核窗口（管理者才拿得到）。 */
export type ReviewDesk = {
  groupId: string | null;
  groupName: string | null;
  groupMembers: { name: string; center: string; duty: string }[];
  roles: ReviewRole[];
  members: { sub: string; name: string; addedAt: string }[];
};

export type ShareSettings = {
  inviteText: string;
  courseText: string;
  linkLead: string;
  siteName: string;
  titleSeparator: string;
  /** 標題最後面的小圖示（預設 🎓；可清空＝不加）。 */
  titleBadge: string;
  /** （已不用於預覽卡片，保留欄位相容舊設定）地址前的圖示。 */
  addressIcon: string;
  showAddress: boolean;
  showQuote: boolean;
  hqName: string;
  /** 沒有地址也沒有金句時，備註顯示的文字（空白＝用 siteName）。 */
  fallbackDescription: string;
  /** 分享「其他教材」（外部連結）的文字範本，可用 {教材名稱}、{課程名稱}、{主講人}、{職稱}；後面接 linkLead 與外部連結網址。 */
  materialText: string;
  /** 分享單一章節的文字範本（課程有兩堂以上章節時，章節清單每列右側的分享鈕）。{主講人}、{職稱}、{章節名稱} 一律取「這一堂章節」自己的設定（分享者、分享者職稱、章節名稱），不用課程的；{課程名稱} 是所屬課程。 */
  chapterText: string;
  /** 分享「清單卡」（杜杜龍 2026-11-16：教材與課程分開設定）：清單頁右上角與課程列的分享，可用 {清單名稱}。 */
  listText: string;
  /** 分享清單卡裡的單一影片（每列右側的分享鈕，點開直接播放這一段）：可用 {影片名稱}、{清單名稱}。 */
  listItemText: string;
  /** 邀請特定會員擔任課程審核人員（24 小時有效的邀請網址）：可用 {課程名稱}；後面接 linkLead 與邀請網址。 */
  reviewerInviteText: string;
  /** 食譜短網址的路徑前綴（杜杜龍 2026-11-26）：網址＝/前綴/流水號（例：/icook/001）。只能小寫英文與連字號、不可含數字（含數字的開頭是會員編號的清單網址）。 */
  recipePrefix: string;
  /** 以前用過的前綴（改前綴時由伺服器自動記下），舊網址照樣打得開。 */
  recipeAliases: string[];
  /** 分享食譜時，放在文字最後的說明＋網址：{網址} 會換成食譜的短網址。 */
  recipeText: string;
  /** 分享食譜時，網址下面再空一行放的上傳者說明：{暱稱}、{中心}（沒有中心時中心省略）。 */
  recipeUploaderText: string;
};
export const DEFAULT_SHARE_SETTINGS: ShareSettings = {
  inviteText: "分享給我的好朋友，這裡有好多精彩的免費講座與課程唷 ❤️",
  courseText: "我剛聽完這場 {主講人}{職稱}的這場精彩演講 {課程名稱} 我就立刻想到要分享給你！",
  linkLead: "按此開啟網址 👉",
  siteName: "寰宇行動大學",
  titleSeparator: " | ",
  titleBadge: "🎓",
  addressIcon: "📍",
  showAddress: true,
  showQuote: true,
  hqName: "寰宇總部",
  fallbackDescription: "",
  materialText: "我推薦你看這份教材：{教材名稱}（{課程名稱}）",
  chapterText: "我剛聽完這場 {主講人}{職稱}的這場精彩演講 {章節名稱} 我就立刻想到要分享給你！",
  listText: "推薦你看「{清單名稱}」，裡面有好多精彩影片，一起來看吧！",
  listItemText: "我剛看完這段精彩影片「{影片名稱}」（{清單名稱}），立刻想到要分享給你！",
  recipePrefix: "icook",
  recipeAliases: [],
  recipeText: "更多食譜按這裡 👉 {網址}",
  recipeUploaderText: "食譜上傳：{暱稱} {中心}",
  reviewerInviteText: "邀請你擔任「{課程名稱}」的報名審核人員。請在 24 小時內點開下方網址並登入寰宇行動大學，按「接受」後就能審核這門課的報名。",
};

/** 食譜的短網址路徑：/前綴/流水號（至少 3 位數，不夠再加位數）。 */
export const recipeShortPath = (prefix: string, n: number) => `/${prefix}/${String(n).padStart(3, "0")}`;

/** 組出「邀請審核人員」的分享文字。 */
export function reviewerInviteMessage(s: ShareSettings, url: string, courseTitle: string): string {
  return `${s.reviewerInviteText.replaceAll("{課程名稱}", courseTitle)}\n\n${s.linkLead}\n${url}`;
}

/**
 * 組出分享選單的文字：一般分享＝邀請文字；單堂課程傳 course 用課程範本；其他教材傳 material；單一章節傳 chapter（姓名、職稱、章節名稱取章節自己的設定，課程只提供課程名稱）；
 * 清單卡傳 list（item＝清單裡某一段影片的名稱；沒有 item＝分享整個清單）。
 */
export function shareMessage(s: ShareSettings, url: string, course?: { teacher: string; teacherTitle?: string; title: string }, material?: { title: string }, chapter?: { sharer: string; sharerTitle?: string; title: string }, list?: { title: string; item?: string }): string {
  if (list && !material) {
    const lead = list.item ? s.listItemText.replaceAll("{影片名稱}", list.item).replaceAll("{清單名稱}", list.title) : s.listText.replaceAll("{清單名稱}", list.title);
    return `${lead}\n\n${s.linkLead}\n${url}`;
  }
  // {職稱}：有職稱就在前面補一個空白再接職稱（「王小明 區域經理」），沒填就整個省略（不留多餘空白）。
  const title = (course?.teacherTitle ?? "").trim();
  const fill = (t: string) => t.replaceAll("{主講人}", (course?.teacher ?? "").trim() || "老師").replaceAll("{職稱}", title ? ` ${title}` : "").replaceAll("{課程名稱}", course?.title ?? "");
  // 章節分享：姓名、職稱、主題都以這一堂章節的設定為準（不是課程的）。
  const cTitle = (chapter?.sharerTitle ?? "").trim();
  const chapterLead = chapter
    ? s.chapterText
        .replaceAll("{主講人}", chapter.sharer.trim() || "老師")
        .replaceAll("{職稱}", cTitle ? ` ${cTitle}` : "")
        .replaceAll("{章節名稱}", chapter.title)
        .replaceAll("{課程名稱}", course?.title ?? "")
    : null;
  const lead = chapterLead ?? (material ? fill(s.materialText).replaceAll("{教材名稱}", material.title) : course ? fill(s.courseText) : s.inviteText);
  return `${lead}\n\n${s.linkLead}\n${url}`;
}

/** 首頁「推薦課程」的規則。 */
export type RecommendRules = {
  /** myCenter＝只推薦我的中心（總部主辦的另依 includeHq）；all＝不分中心。 */
  scope: "myCenter" | "all";
  /** 「我的中心」範圍下，是否也納入只有總部主辦（沒有中心）的課程。 */
  includeHq: boolean;
  /** 只推薦符合我獎銜資格的課程。 */
  onlyEligible: boolean;
  /** 不推薦已結束的課程（活動日已過）。 */
  hideEnded: boolean;
  /** 同系列的課只推薦最近的一場。 */
  collapseSeries: boolean;
  /** 排序：list＝照「全部課程」的排序；soonest＝日期最近的在前；newest＝最新建立的在前。 */
  order: "list" | "soonest" | "newest";
  /** 最多推薦幾門（0＝不限）。 */
  max: number;
};
/**
 * Cloudflare 即時縮圖的全部選項（杜杜龍 2026-11-20）：對應 Cloudflare Images 的參數。
 * 預設全部關閉或中性值；只有被改成非預設值的選項才會送給 Cloudflare。
 */
export type ThumbSettings = {
  enabled: boolean;
  /** 允許的縮圖寬度（像素）；前端依畫面大小挑最接近的一種，每張圖每種寬度算一次「不重複縮圖」。 */
  widths: number[];
  /** 高度＝寬度的幾倍（0＝依原圖比例）；例：0.5625＝16:9。 */
  height: number;
  fit: "scale-down" | "contain" | "cover" | "crop" | "pad" | "squeeze";
  gravity: "auto" | "center" | "face" | "left" | "right" | "top" | "bottom";
  /** auto＝依瀏覽器（avif／webp 優先，不支援就 jpeg）。 */
  format: "auto" | "avif" | "webp" | "jpeg" | "png";
  quality: number;
  /** 用文字等級取代數字畫質（空字串＝用數字）。 */
  qualityLevel: "" | "high" | "medium-high" | "medium-low" | "low";
  anim: boolean;
  metadata: "none" | "keep" | "copyright";
  rotate: 0 | 90 | 180 | 270;
  flip: "" | "h" | "v" | "hv";
  blur: number;
  sharpen: number;
  brightness: number;
  contrast: number;
  gamma: number;
  saturation: number;
  /** 補邊或透明背景的底色（空字串＝不指定）。 */
  background: string;
  /** 四邊各裁掉的像素（0＝不裁）。 */
  trim: number;
  borderWidth: number;
  borderColor: string;
  /** 每月縮圖額度與優先順序（杜杜龍 2026-11-24）：封面 > 中心 EDM > 其他相簿；EDM、相簿各自最多用到額度的幾％（預留給更高優先的）。 */
  quota: { monthly: number; edmPct: number; albumPct: number };
};
export const THUMB_WIDTH_CHOICES = [240, 320, 480, 640, 800, 960, 1280, 1600];
/** 平板、電腦用的大尺寸（杜杜龍 2026-11-20）：固定可用，不必在設定頁勾選。 */
export const THUMB_WIDE_WIDTHS = [1280, 1600];

export type AppSettings = {
  /** 首頁左邊「繼續學習」自動輪播間隔（秒；0＝不自動輪播）。 */
  homeLeftSec: number;
  /** 首頁右邊「推薦課程」自動輪播間隔（秒；0＝不自動輪播）。 */
  homeRightSec: number;
  /** 手指滑過首頁區塊後，暫停自動輪播多久（秒）。 */
  homePauseSec: number;
  /** 首頁公告跑馬燈換下一則的間隔（秒）與手指滑過後的暫停（秒）。 */
  tickerSec: number;
  tickerPauseSec: number;
  rec: RecommendRules;
  /** 課程「新」標籤：建立幾天內算新。 */
  freshDays: number;
  /** 圖片「完整顯示」合成封面時的背景模糊強度（數字越大越模糊）。 */
  blurStrength: number;
  /** 學習紀錄：播放超過這個比例（%）就算「開始學習」（課程列入「學習中」）。 */
  learnStartPct: number;
  /** 學習紀錄：播放超過這個比例（%）（或播到結尾）自動標記這一堂完成。 */
  learnDonePct: number;
  /** 學習紀錄：播放進度每次回報的最短間隔（秒）。 */
  watchReportSec: number;
  /** 集滿幾枚徽章自動解鎖「我的書櫃」鑰匙（杜杜龍 2026-11-18 起可在後台「徽章任務設定」調整）。 */
  libraryKeyBadges: number;
  /** 「我的清單」（杜杜龍 2026-11-21）：每位會員一開始能建立幾份清單，以及完成指定學習成就後各多解鎖幾份（設定頁「清單解鎖設定」）。 */
  listBaseQuota: number;
  listUnlocks: { achievementId: string; extra: number }[];
  /** 上傳檔案設定（杜杜龍 2026-11-18，在「儲存空間管理」調整）：單檔大小上限（MB）、圖片壓縮長邊（像素）與畫質（%）。 */
  fileMaxMb: number;
  imageMaxSide: number;
  imageQuality: number;
  /** 中心封面照片（中心首頁圖）的壓縮：長邊與畫質，比一般圖片更高（杜杜龍 2026-11-18）。 */
  centerMaxSide: number;
  centerQuality: number;
  /** EDM 海報原圖：長邊像素與畫質（小字與 QR code 要看得清楚，預設較高）。 */
  edmMaxSide: number;
  edmQuality: number;
  /** 封面輪播與短影音（杜杜龍 2026-11-21，在「儲存空間管理」同一區調整）：照片停留秒數、短影音壓縮規範（在上傳者的瀏覽器內壓縮）。 */
  coverSec: number;
  videoMaxHeight: number;
  videoKbps: number;
  videoFps: number;
  videoMaxMb: number;
  videoMaxSec: number;
  /** 所有上傳圖片存進雲端時統一轉成的格式（杜杜龍 2026-11-20；預設 JPEG，相容性最好）。 */
  storeFormat: "jpeg" | "webp" | "avif";
  /** 相簿照片的獨立存檔格式與畫質（杜杜龍 2026-11-25，先在「成交百寶箱」試行；通過後才全站）。albumScope：off＝不啟用、treasure＝只有成交百寶箱、all＝全部相簿。 */
  albumFormat: "jpeg" | "webp" | "avif";
  albumQuality: number;
  albumScope: "off" | "treasure" | "all";
  /** Cloudflare 即時縮圖（杜杜龍 2026-11-20 小範圍試用）：封面縮圖的所有選項，在「設定 › Cloudflare即時縮圖」調整。 */
  thumb: ThumbSettings;
};
export const DEFAULT_APP_SETTINGS: AppSettings = {
  homeLeftSec: 5,
  homeRightSec: 5,
  homePauseSec: 8,
  tickerSec: 4,
  tickerPauseSec: 8,
  rec: { scope: "myCenter", includeHq: true, onlyEligible: true, hideEnded: false, collapseSeries: true, order: "list", max: 0 },
  freshDays: 7,
  blurStrength: 18,
  learnStartPct: 1,
  learnDonePct: 95,
  watchReportSec: 10,
  libraryKeyBadges: 100,
  listBaseQuota: 2,
  listUnlocks: [],
  fileMaxMb: 95,
  imageMaxSide: 1024,
  imageQuality: 88,
  centerMaxSide: 2048,
  centerQuality: 95,
  edmMaxSide: 2048,
  edmQuality: 90,
  coverSec: 2,
  videoMaxHeight: 720,
  videoKbps: 2500,
  videoFps: 30,
  videoMaxMb: 25,
  videoMaxSec: 60,
  storeFormat: "jpeg",
  albumFormat: "avif",
  albumQuality: 60,
  albumScope: "treasure",
  thumb: { enabled: false, widths: [320, 480, 640], height: 0, fit: "scale-down", gravity: "auto", format: "auto", quality: 70, qualityLevel: "", anim: true, metadata: "none", rotate: 0, flip: "", blur: 0, sharpen: 0, brightness: 1, contrast: 1, gamma: 1, saturation: 1, background: "", trim: 0, borderWidth: 0, borderColor: "#ffffff", quota: { monthly: 5000, edmPct: 90, albumPct: 70 } },
};
export const STATS_ROLE_OPTIONS: { key: string; title: string }[] = [
  { key: "president", title: "會長" },
  { key: "sound", title: "音控" },
  { key: "course", title: "課務" },
  { key: "reviewer", title: "審核員" },
];
export const DEFAULT_UI_CONFIG: UiConfig = {
  sortGroups: [...SORT_GROUPS],
  seriesOrder: [],
  albumOrder: [],
  ribbons: {
    public_free: { label: "免費公開", color: "ok", enabled: true },
    learning: { label: "學習中", color: "green", enabled: true },
    completed: { label: "已聽完", color: "olive", enabled: true },
    pending: { label: "報名審核中", color: "orange", enabled: true },
    can_register: { label: "可以報名", color: "yellow", enabled: true },
    ineligible: { label: "獎銜不符", color: "danger", enabled: true },
    price_tba: { label: "費用尚未公布", color: "warn", enabled: true },
    countdown: { label: "倒數 {n} 天", color: "salmon", enabled: true },
    in_progress: { label: "進行中", color: "greenDark", enabled: true },
    ended: { label: "已結束", color: "muted", enabled: true },
  },
  statsRoles: [],
  app: DEFAULT_APP_SETTINGS,
  share: DEFAULT_SHARE_SETTINGS,
};
