/** 前後端共用的資料格式：相簿、食譜卡、縮圖徽章、職務、播放、錯誤格式、通知分類、刪除影響（杜杜龍 2026-11-27 從 contract.ts 依功能拆出；contract.ts 會全部轉出，舊的 import 不用改）。 */
import type { Role } from "./members-courses.ts";
import type { AlbumFolder, CentralReview, CoverScope } from "./orders-central.ts";

/** 相簿資訊總覽（超級管理員，杜杜龍 2026-11-25）：R2 佔用、上傳者排名、最近上傳、檔案大小與瀏覽數排序，以及這個相簿的上傳權限。 */
export type AlbumInfo = {
  id: string;
  title: string;
  count: number;
  bytes: number;
  lastUploadAt: string | null;
  uploaders: { name: string; count: number; bytes: number }[];
  bySize: { id: string; url: string; bytes: number }[];
  byViews: { id: string; url: string; views: number }[];
  /** 這個資料夾自己設定的上傳最低獎銜（null＝沒設定，沿用類別）；inherited＝實際生效的（含類別）。 */
  uploadMinRank: string | null;
  effectiveRank: string;
  groupId: string;
  groupRank: string;
};
export type AlbumPermissions = { ranks: { code: string; name: string }[]; groups: { id: string; label: string; uploadMinRank: string }[]; folders: { id: string; title: string; groupId: string; count: number; uploadMinRank: string | null }[] };
/** 區塊相簿的子資料夾（杜杜龍 2026-11-26）：folders 依張數多到少；uncat＝還沒分資料夾的照片（固定排最後）。 */
export type AlbumSubfolder = { id: string; name: string; count: number; thumbs: string[] };
/** 食譜專區（杜杜龍 2026-11-26）：一道食譜＝名稱＋分類＋多張照片（cover_media，owner_key＝`rcp:`＋編號）＋一篇純文字（獨立一行的 YouTube 網址＝影片卡片）。 */
export type RecipeCategory = { id: string; name: string; count: number };
export type RecipeCard = { /** 建立（上傳）時間，相簿的「上傳時間排序」用。 */ createdAt: string; /** 上傳者暱稱與所屬中心（建立時自動抓，不可手動改；超級管理員可更換上傳者）。 */ authorCenter: string; id: string; title: string; categoryId: string; categoryName: string; status: "pending" | "published"; thumb: string | null; photos: number; videos: number; authorName: string; /** 這道食譜我可不可以修改／刪除。 */ canEdit: boolean };
export type RecipesResponse = { categories: RecipeCategory[]; recipes: RecipeCard[]; /** 管理者（超級管理員或「食譜」上傳獎銜達標）：可直接發佈、審核投稿、新增與改名分類。 */ manager: boolean; /** 超級管理員：可刪除分類。 */ admin: boolean; /** 已登入的會員可以投稿。 */ canSubmit: boolean };
export type RecipeDetail = { authorCenter: string; /** 超級管理員（可更換上傳者）。 */ admin: boolean; id: string; /** 流水號（送出後才有）與短網址路徑（例：/icook/001）。 */ number: number | null; shortPath: string | null; title: string; categoryId: string; categoryName: string; body: string; status: "draft" | "pending" | "published"; authorName: string; updatedAt: string; canEdit: boolean; manager: boolean };
export type AlbumSubfolders = { folders: AlbumSubfolder[]; uncat: { count: number; thumbs: string[] }; canManage: boolean };
export type AlbumGroup = { id: string; label: string; folders: AlbumFolder[] };
export type AlbumsResponse = { total: number; groups: AlbumGroup[]; /** 相簿首頁與側邊欄的類別順序（含「食譜」專區 `recipe`；依設定的 albumOrder，超級管理員可調）。 */ order: string[] };
/** 封面輪播／相簿的一個項目：image 或短影音；width／height 為 0＝尺寸未知（當橫式）。 */
export type CoverMediaItem = { id: string; scope: CoverScope; /** 相簿照片（區塊照片）的 AI 場景標籤，逗號分隔（杜杜龍 2026-11-24）。 */ scene?: string; /** 上傳時間（相簿資料夾排序用）。 */ createdAt?: string; /** 上傳者暱稱與頭像（單張看圖顯示；舊照片沒有）。 */ uploader?: string; uploaderAvatar?: string; /** 區塊相簿的子資料夾編號（沒有＝未分類）。 */ folderId?: string; /** 綁定的課程（課程 EDM 併入中心 EDM 空間；綁定的照片不能刪，只能更換）。 */ courseId?: string | null; courseTitle?: string | null; kind: "image" | "video"; url: string; posterUrl: string | null; width: number; height: number; durationSec: number; /** 中心 EDM：AI 辨識出的活動日期（YYYY-MM-DD）與海報文字（搜尋用）；還沒辨識完是 null／空字串。 */ eventDate?: string | null; text?: string };
/** 縮圖符號（杜杜龍 2026-11-23）：系列卡、課程卡、中心卡的小縮圖。symbol＝emoji 或短文字（最多 4 個字）；fg 文字色、bg 底色（#RRGGBB）。 */
export type ThumbBadgeKind = "course" | "series" | "center";
export type ThumbBadge = { kind: ThumbBadgeKind; key: string; symbol: string; fg: string; bg: string };
/** 設定頁總覽的一列：沒設定時 badge 是 null。 */
export type ThumbBadgeRow = { kind: ThumbBadgeKind; key: string; label: string; sub: string; badge: ThumbBadge | null };
/** 縮圖符號的色票（畫面上點選；也可輸入自訂色碼）。 */
export const THUMB_BADGE_COLORS = ["#0C603C", "#2F5D3A", "#4C8A5B", "#8B6F47", "#B3261E", "#D97706", "#E6B422", "#2563A8", "#6B4FA0", "#374151", "#FFFFFF", "#F4EFE6"] as const;
export const THUMB_BADGE_KINDS: ThumbBadgeKind[] = ["course", "series", "center"];
export type StaffRole = { value: string; label: string };
export type StaffMember = { memberId: string; name: string; center: string; roles: string[] };
/** available＝false：中央判斷沒有權限（任何非 200 都當沒有權限）；members 只在這次請求即時讀取，不保存。 */
export type StaffSearch = { available: boolean; assignable: StaffRole[]; members: StaffMember[] };
export type CentralReviews = { available: boolean; scope: "all" | "center" | null; reviews: CentralReview[] };

/** demo 的 url 可能是相對路徑（以 API 網域為準），App 端以 resolveUrl 轉成完整網址。hls 為 Mux 簽名播放網址。 */
/** resumeAt＝續播起點（影片本身的秒數；這一堂還沒看完、上次停在中間才有）。 */
export type Segment = { start: number | null; end: number | null; resumeAt?: number };
export type Playback = Segment &
  ({ kind: "demo"; url: string; label: string } | { kind: "youtube"; videoId: string } | { kind: "hls"; url: string } | { kind: "audio"; url: string });

export type AppConfig = { demoLogin: boolean };

export type MuxAsset = {
  assetId: string;
  title: string;
  durationSeconds: number | null;
  createdAt: string | null;
  status: string;
  signedPlaybackId: string | null;
  thumbnailUrl: string | null;
};
export type MuxAssetPage = { assets: MuxAsset[]; nextCursor: string | null };

export type ApiError = { error: { code: string; message: string } };

export const HQ_UNIT = "寰宇總部";

export const DEMO_MEMBERS: { sub: string; name: string; rankCode: string; role: Role; roles?: string[]; hglobal?: boolean; center?: string }[] = [
  { sub: "demo-student", name: "測試學員", rankCode: "platinum", role: "student", hglobal: true, center: "台北中心" },
  { sub: "demo-silver", name: "測試學員（銀章）", rankCode: "silver", role: "student", hglobal: true, center: "台中中心" },
  { sub: "demo-outsider", name: "測試學員（非寰宇）", rankCode: "none", role: "student" },
  { sub: "demo-desk", name: "測試窗口", rankCode: "gold", role: "student", hglobal: true, center: "台北中心" },
  { sub: "demo-president", name: "測試會長", rankCode: "emerald", role: "student", roles: ["president"], hglobal: true, center: "台北中心" },
  { sub: "demo-admin", name: "測試管理員", rankCode: "diamond", role: "admin", roles: ["super_admin"], hglobal: true },
];

export type CourseComment = {
  id: string;
  courseId: string;
  authorName: string;
  mine: boolean;
  body: string;
  hidden: boolean;
  createdAt: string;
  /** 以下只在管理員的檢舉清單提供。 */
  reports?: number;
  courseTitle?: string;
};

/** 品牌 logo 封面的組成：底圖（優先）或底色（沒有就白色）＋ logo 置中、四周留安全距離。 */
export type BrandCover = { logoUrl: string; bgColor: string | null; /** 深色模式的底色（杜杜龍 2026-11-18）：使用者切換成深色模式時優先於底色與底圖；沒設定＝null。 */ bgColorDark: string | null; bgUrl: string | null };
/** 後台品牌 logo 管理用。 */
export type BrandLogo = { id: string; name: string; logoUrl: string | null; bgColor: string | null; bgColorDark: string | null; bgUrl: string | null };

/** 通知情境（Email 可逐項開關，杜杜龍 2026-11-18）：預設只有「付費課程相關的審核通知」要寄 Email，其餘預設不寄；手機推播不看這個，全部都推。 */
export type NoticeKind = "paid_review" | "role" | "course_update" | "subscribe_new" | "broadcast" | "reminder" | "comment" | "badge" | "other";
export const NOTICE_KINDS: { key: NoticeKind; label: string; desc: string; emailDefault: boolean }[] = [
  { key: "paid_review", label: "付費課程相關的審核通知", desc: "報名送出、待審核、繳費確認、開通、退回、延後、報名留言", emailDefault: true },
  { key: "role", label: "身分與職務指派", desc: "被指派為審核人員、中心小編，或不再是小編", emailDefault: false },
  { key: "course_update", label: "已報名課程的更新", desc: "課程有新章節、新教材，或上課日期、地點有更新", emailDefault: false },
  { key: "subscribe_new", label: "訂閱的中心與系列", desc: "訂閱的中心或系列有新課程、新清單上架", emailDefault: false },
  { key: "broadcast", label: "中心廣播公告", desc: "訂閱的中心發布新的廣播公告", emailDefault: false },
  { key: "reminder", label: "開課前一天提醒", desc: "明天要上的課程提醒（晚上 8 點後）", emailDefault: false },
  { key: "comment", label: "留言與檢舉", desc: "留言回覆、有留言被檢舉等", emailDefault: false },
  { key: "badge", label: "獲得學習徽章", desc: "達成徽章任務時的恭喜通知", emailDefault: false },
  { key: "other", label: "其他系統通知", desc: "上面沒有列到的通知", emailDefault: false },
];
/** 依通知標題與連結判斷屬於哪一種情境。 */
export function noticeKindOf(title: string, link: string): NoticeKind {
  if (/^\/(admin\/)?orders\//.test(link) || /^\/admin\/orders/.test(link)) return "paid_review";
  if (/審核人員|小編/.test(title)) return "role";
  if (/獲得學習徽章/.test(title)) return "badge";
  if (/開課提醒/.test(title)) return "reminder";
  if (/廣播公告/.test(title)) return "broadcast";
  if (/有新(課程|清單)/.test(title)) return "subscribe_new";
  if (/有新(章節|教材)|時間或地點有更新/.test(title)) return "course_update";
  if (/留言|回覆|檢舉/.test(title)) return "comment";
  if (/審核|等待|報名已|報名延後|課程已開通|繳費確認|開通已撤銷|邀請碼/.test(title)) return "paid_review";
  return "other";
}

/** 通知設定：Email 的正本在會員中心「聯絡信箱」，這裡只是同一個欄位的入口。 */
export type NotificationSettings = {
  email: string | null;
  notifyEmail: boolean;
  /** 各情境要不要寄 Email（已套用預設值；手機推播一律全收，不受影響）。 */
  emailKinds: Record<NoticeKind, boolean>;
  /** 伺服器是否已啟用寄信（未啟用時畫面提示「Email 通知尚未開放」）。 */
  emailReady: boolean;
  source: "central" | "local";
};

/** 附件類型：上傳檔案依副檔名判斷，網址依網域判斷；畫面依類型顯示圖示。 */
export type AttachmentType =
  | "youtube"
  | "vimeo"
  | "canva"
  | "google_slides"
  | "google_docs"
  | "google_sheets"
  | "google_forms"
  | "google_drive"
  | "notion"
  | "web"
  | "pdf"
  | "word"
  | "ppt"
  | "excel"
  | "zip"
  | "image"
  | "text"
  | "file";

/**
 * 章節附件教材：上傳檔案（kind=file，url 為 1 小時內有效的簽名下載網址）或外部網址（kind=link，url 為原網址）。
 * name 是管理員自訂的顯示標題；url 只給已開通學員與管理員。
 */
export type Attachment = { id: string; name: string; kind: "file" | "link"; type: AttachmentType; size: number; url?: string };

/** 刪除課程前的影響統計（有報名紀錄時，畫面要求輸入 YES 才能刪除）。 */
export type CourseDeleteImpact = { title: string; registrations: number; pending: number; opened: number; students: number; comments: number; paidTwd: number };


/** 封面底圖圖庫的一張圖。uploaderName／uploaderCenter 只在管理人員開啟圖庫時提供。 */

/** 首頁跑馬燈公告（只有超級管理員與總部秘書可管理）。 */
export type Announcement = { id: string; text: string; enabled: boolean };

/** 「完善資料」視窗的內容：真實姓名、Email，以及勾選 Amway 會員時的系統、中心、獎銜。 */
export type ProfileForm = {
  legalName: string;
  /** 暱稱（中央會員的 display_name）。 */
  nickname: string;
  email: string;
  /** 會員自己的 Google 登入信箱（中央 info.google_email；聯絡信箱還空著時預先帶入，不保存）。 */
  googleEmail?: string;
  enabled: boolean;
  hglobal: boolean;
  /** 中央標為寰宇的「培訓系統」詞（選到其中一個，中心改用中心清單）。 */
  hglobalSystems: string[];
  fields: Record<"education_system" | "education_center" | "rank" | "upline_platinum" | "upline_diamond", { value: string; pending: string | null; status: string }>;
  rankOptions: { value: string; label: string }[];
  /** 中央提供的自訂系統提醒詞與提醒範本（{word} 換成命中的詞）；讀不到就沒有，畫面不顯示提醒。 */
  hglobalCenterWords?: string[];
  hglobalCenterMessage?: string;
};
