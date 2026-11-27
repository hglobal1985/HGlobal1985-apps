/** 前後端共用的資料格式：會員身分、課程、專區、誰能瀏覽、課程頁、系列套用（杜杜龍 2026-11-27 從 contract.ts 依功能拆出；contract.ts 會全部轉出，舊的 import 不用改）。 */
import type { PaymentReport } from "./orders-central.ts";
import type { AttachmentType, BrandCover, CoverMediaItem, ProfileForm } from "./media-misc.ts";

/**
 * API 契約（/api/v2）。App 端以 `import type` 取用，兩邊共用同一份型別。
 * 這個檔案只能放型別與常數，不能引用 Worker 專用的東西。
 */
export type Role = "student" | "admin";
export type ClientPlatform = "web" | "ios" | "android";

export type Rank = { code: string; name: string; order: number };

export type Member = {
  sub: string;
  name: string;
  /** 只有模擬會員有示範獎銜；中央會員的獎銜屬 Amway 資料，App 不取得（null）。 */
  rank: Rank | null;
  role: Role;
  demo: boolean;
  /** 會員中心的頭像網址（公開；沒有頭像或模擬會員為 null）。 */
  avatarUrl?: string | null;
  /** 對外獎銜（取自會員中心；獎銜為「無」顯示「安麗寶寶」）。只放記憶體，不存資料庫。 */
  rankLabel?: string | null;
  /** 獎銜徽章圖網址（沒有徽章的獎銜為 null）。取自會員中心（完整網址）；只放記憶體，不存資料庫。 */
  rankBadge?: string | null;
  /** 徽章圖案範圍（畫布 width×height 內的上下緣，供閃光特效定位）；沒有徽章為 null。 */
  rankBadgeArt?: { width: number; height: number; top: number; bottom: number } | null;
  /** 會員中心資料還有哪些空白（例如「Email」「Amway 會員資料」）；空陣列表示完整。 */
  profileMissing?: string[];
  /** 資料不完整時一併帶回的「完善資料」視窗內容（即時取自會員中心，不保存）。 */
  profileForm?: ProfileForm;
  /** 職務名稱（中央職務＋本 App 的窗口身分），顯示用。 */
  titles: string[];
  /** 是否有任何報名審核權限。 */
  reviewer: boolean;
  /** 已核准的中心名稱（沒有則 null）。 */
  center: string | null;
  /** 可以使用「統計分析」頁（超級管理員、總部秘書，或被超級管理員指定的職務）。 */
  canViewStats?: boolean;
  /** 課程管理權限（總部、該中心的會長與音控、小編）。沒有任何課程權限為 undefined。 */
  courseRights?: CourseRights;
};

/** 登入者的課程管理權限摘要（前端用來決定要不要顯示「＋新增」「編輯」「小編管理」等入口；後端每個請求仍會再檢查）。 */
export type CourseRights = {
  /** 總部（超級管理員、總部秘書）：所有中心。 */
  all: boolean;
  /** 可以新增課程。 */
  create: boolean;
  /** 可以管理小編（總部、會長、音控）。 */
  manageEditors: boolean;
  /** 所屬中心（總部可能為 null）。 */
  center: string | null;
  /** 小編身分（不是小編為 null）。 */
  editor: { create: boolean; editOthers: boolean; deleteOthers: boolean } | null;
};

/** 這位管理者對某門課能做什麼（只有管理者拿得到）。 */
export type CourseCan = {
  /** 修改內容、章節、上架／下架。 */
  edit: boolean;
  /** 刪除（沒人報名）或下架封存（有人報名）。 */
  remove: boolean;
  /** 把「下架封存」的課程還原。 */
  restore: boolean;
};

/** 小編（各中心自己的編輯人員，只存在行動大學）。 */
export type CourseEditor = {
  memberId: string;
  name: string;
  center: string;
  canCreate: boolean;
  canEditOthers: boolean;
  canDeleteOthers: boolean;
  createdAt: string;
};
/** 指派小編時從會員中心取得的同中心會員（不保存）。 */
export type EditorCandidate = { memberId: string; name: string; avatarUrl: string | null; signedIn: boolean; already: boolean };

/** 中心 EDM（全部課程頁選了中心才顯示）。 */
/** 中心 EDM：edmUrl 整張海報；coverUrl 裁切後的 16:9 封面（中心卡縮圖）；coverRect／edmViewY＝裁切框與預設停留位置（同步）。 */
export type CenterArt = { centerKey: string; center: string; edmUrl: string; coverUrl: string | null; coverRect: { x: number; y: number; w: number } | null; edmViewY: number };

/** 系列頁上方的照片（與中心的 CenterArt 同一套：EDM＋16:9 封面＋裁切框＋預設停留位置）。 */
export type SeriesArt = { series: string; edmUrl: string; coverUrl: string | null; coverRect: { x: number; y: number; w: number } | null; edmViewY: number };

/** 沒有系列的課程卡一律放進這個系列：只有超級管理員看得到（杜杜龍 2026-11-19）。清單卡沒有系列照舊直接在第一層。 */
export const UNCATEGORIZED = "未分類";
/** 系列的設定（標題只改顯示，不動識別名稱 series）。 */
export type SeriesSetting = { series: string; title: string; showInAll: boolean };

export type EnrollmentState = "opened" | "pending" | null;

/**
 * 固定格式的文字封面（杜杜龍 2026-11-19）：名稱以這些字開頭的課程，封面一律只有文字＋咖啡色系底，且固定「名稱（換行）X年X月」兩行，
 * 不用 YouTube 縮圖當封面（後端 courseArt）。例：「銅章會議2026年10月」→ ["銅章會議", "2026年10月"]。要新增別的固定格式封面只改這張表。
 */
export const TEXT_COVER_PREFIXES = ["銅章會議"] as const;
export function textCoverLines(title: string | null | undefined): string[] | null {
  const t = (title ?? "").trim();
  const head = TEXT_COVER_PREFIXES.find((p) => t.startsWith(p));
  if (!head) return null;
  const rest = t.slice(head.length).trim();
  return rest ? [head, rest] : [head];
}

/** 誰可以瀏覽：所有人含訪客／所有會員／寰宇夥伴／中心會員。 */
/** 寰宇大學「所有系列」檢視的三個專區（杜杜龍 2026-11-18）。空字串＝沒指定：課程放 hglobal、清單放 amway_material。 */
export type Zone = "hglobal" | "amway_material" | "amway_brand";
export const ZONES: { id: Zone; label: string }[] = [
  { id: "hglobal", label: "寰宇課程活動" },
  { id: "amway_material", label: "安麗官方資源" },
  { id: "amway_brand", label: "安麗品牌館" },
];
export const zoneOf = (raw: string | null | undefined, isList: boolean): Zone => (ZONES.some((z) => z.id === raw) ? (raw as Zone) : isList ? "amway_material" : "hglobal");

export type ViewScope = "all" | "members" | "hglobal" | "center" | "link_login" | "link_guest";
export const VIEW_SCOPES: ViewScope[] = ["all", "members", "hglobal", "center", "link_login", "link_guest"];
export const VIEW_SCOPE_LABEL: Record<ViewScope, string> = { all: "所有人含訪客", members: "所有會員", hglobal: "寰宇夥伴", center: "中心會員", link_login: "私密連結（需登入）", link_guest: "私密連結（訪客可）" };

export type CourseSummary = {
  id: string;
  title: string;
  subtitle: string;
  teacher: string;
  /** 主講人的獎銜（中央獎銜代碼，沒填為空字串）與顯示名稱、職稱。 */
  teacherRank: string;
  teacherRankName: string;
  teacherTitle: string;
  /** 勾了「無」：沒有主講人、獎銜、職稱（畫面隱藏這三個欄位），專屬網址用課程名稱的英譯。 */
  noSpeaker: boolean;
  /** 套裝課程（杜杜龍 2026-11-19）：只是分類篩選用途，不改變版面與功能；日期區間 7 天以上時編輯畫面會自動勾選。 */
  isPackage: boolean;
  category: string;
  /** iOS/Android 請求時一律為 null（商店規範：App 內不顯示價格）。 */
  priceTwd: number | null;
  free: boolean;
  minRank: Rank;
  theme: string;
  status: "draft" | "published" | "archived";
  lessonCount: number;
  /** 有上傳教材：任何一堂（章節或其他教材）設了影音來源，或有附件。「寰宇教育中心」清單的排序只算這樣的課程。 */
  hasMaterial: boolean;
  /** 品牌（杜杜龍 2026-11-18，獨立於分類）：brand_logos 的 id 與名稱。 */
  brandId: string | null;
  brandName: string | null;
  /** 所屬專區（杜杜龍 2026-11-18）。 */
  zone: Zone;
  /** 選了品牌、且沒有手動上傳封面時才有：logo 圖、底色、底圖。 */
  brand: BrandCover | null;
  /** 清單類別：勾了「顯示在上拉選單」的區塊（杜杜龍 2026-11-18）；課程類別永遠是空陣列。 */
  blocks: { id: string; title: string; coverUrl: string | null; brand: BrandCover | null; count: number; categories: string; brandId: string | null }[];
  /** 系列內的手動順序（0＝還沒排過；沒排過的新卡自動排最前面）。 */
  seriesOrder: number;
  /** 在系列頁隱藏（杜杜龍 2026-11-19）：只是不在系列頁顯示，仍可用網址、搜尋、單元找到。 */
  seriesHidden: boolean;
  /** 素材（教材）數量：有影音來源或外部連結的項目數（清單卡的上拉選單標籤用）。 */
  materialCount: number;
  totalMinutes: number;
  eligible: boolean;
  /** 會長不受獎銜限制也可報名。 */
  allowPresident: boolean;
  /** 指定邀請制（杜杜龍 2026-11-20）：不看獎銜、一律人工審核；inviteHasCode＝有設邀請碼（輸入正確免審核）。邀請碼本身只給課程管理者（GET /admin/courses/:id/invite）。 */
  inviteOnly: boolean;
  inviteHasCode: boolean;
  /** 這位登入者能不能看這門課的報名名單（管理者、有審核權限的人；杜杜龍 2026-11-20）。 */
  canRoster: boolean;
  /** 指導單位、主辦單位（空字串表示未設定）。 */
  guidanceUnit: string;
  hostUnit: string;
  /** 活動日期（YYYY-MM-DD）；eventEnd 只有連續多天的活動才有（天數不設上限）。 */
  eventStart: string | null;
  eventEnd: string | null;
  /** 完全公開：未登入的訪客也能瀏覽介紹與章節、觀看（只限免費課程）。 */
  isPublic: boolean;
  /** 誰可以瀏覽（杜杜龍 2026-11-17）。 */
  viewScope: ViewScope;
  /** 這位會員審核中的報名編號（沒有為 null）；點「付款審核中」直接進完整的報名明細與訊息頁。 */
  pendingOrderId: string | null;
  /** 費用尚未公布：顯示「費用尚未公布」、暫不開放報名。 */
  priceTba: boolean;
  hideFromHome: boolean;
  /** 這門課「鑽石免費」（鑽石以上獎銜的會員報名免費）；diamondFreeNow＝對目前登入的這位會員已生效。 */
  /** 系列名稱（空字串＝不合併）：同系列的課，全部課程清單只顯示最近的一場。 */
  series: string;
  /** 系列專屬 EDM 網址（沒上傳為 null）。 */
  seriesEdmUrl: string | null;
  /** 系列封面（管理員裁切好的 16:9 版本，沒裁切為 null）；全部課程的系列小卡優先用它。 */
  seriesCoverUrl: string | null;
  /** 設定免費、而且這位會員符合資格：不用報名就能收看。 */
  watchFree: boolean;
  /** 學員把這門免費課程從「學習中」隱藏了（再打開課程頁會恢復）。 */
  hiddenFromLearning: boolean;
  /** 播放過這門課超過 1%（或已有完成章節）：即使沒有報名紀錄也會列入「學習中」。 */
  started: boolean;
  /** 課程勾選「章節各自設定封面」：章節編輯時才會出現封面設定。 */
  chapterCovers: boolean;
  /** 課程開放「區塊新增照片」（杜杜龍 2026-11-24，先只有成交百寶箱）：編輯模式每個區塊多一個「新增照片」，學員在區塊裡看照片格。 */
  blockPhotos: boolean;
  /** 中心課程：只在「寰宇教育中心」頁出現，不在「全部課程」出現。 */
  centerCourse: boolean;
  /** 短影音專輯：這門課的章節與影音教材在「單元」頁歸類為短影音。 */
  isShorts: boolean;
  /** 清單卡（杜杜龍 2026-11-16）：只有「其他教材」，沒有章節、時間地點、費用、主講人；影片教材在 App 內播放並計入學習進度。 */
  isList: boolean;
  /** 課程專屬網址路徑（中心縮寫/英譯姓名-編號）；缺資料時為 null，用 /course/編號。 */
  shortPath: string | null;
  /** 素材的第二層網址名稱（/系列縮寫/這個名稱）；沒設定為 null。 */
  matUrl: string | null;
  /** 課程建立時間（ISO）；「分類」選單的「新」標籤用。 */
  createdAt: string;
  /** 付費課程（原價大於 0；限時免費、早鳥、鑽石免費仍算）。學習中的課程卡用來顯示「付費課程」標籤（不寫金額）。 */
  paid: boolean;
  /** 最近一次學習（播放、完成章節）的時間（ISO）；從沒學習過是 null。「學習中」依這個由新到舊排序。 */
  lastLearnedAt: string | null;
  diamondFree: boolean;
  diamondFreeNow: boolean;
  /** 早鳥優惠（null＝沒有設定）：until 為截止日（含當天，台灣時間）；active＝現在還在優惠期間。priceTwd 在 App 為 null。 */
  earlyBird: { priceTwd: number | null; until: string; active: boolean } | null;
  /** 上課地點；locationNone 為 true 時公開卡片不顯示。 */
  location: string;
  locationNone: boolean;
  /** 線上課程：地點顯示為「線上課程」。 */
  isOnline: boolean;
  /** 目前是否在限時免費期間；originalPriceTwd 為原價（App 為 null）。 */
  freeNow: boolean;
  originalPriceTwd: number | null;
  freeUntil: string | null;
  enrollment: EnrollmentState;
  completedLessons: number;
  /** 學習進度百分比（0～100）：每堂都有長度就依長度算，否則依章節數算。 */
  progressPercent: number;
  /** 課程海報 EDM（直式）的公開網址；沒有上傳時為 null。 */
  edmUrl: string | null;
  /** 從 EDM 裁切出來的 16:9 橫式封面（課程清單縮圖）；沒有時畫面改用色塊。 */
  coverUrl: string | null;
  /** EDM 預設停留位置（原圖高度的比例 0～1）。 */
  edmViewY: number;
  /** 封面裁切框（占 EDM 圖寬高的比例，高由 16:9 算出）；課程介紹頁的預設停留位置＝它的上緣（永遠同步）。null＝未知（舊資料）。 */
  coverRect: { x: number; y: number; w: number } | null;
  /** 主辦中心（第一個非總部的主辦單位）與其正規化代碼；全部課程頁「中心」篩選用。沒有為空字串／null。 */
  hostCenter: string;
  hostCenterKey: string | null;
  /** 只有管理清單（/admin/courses）與管理者看課程頁時才有：這位管理者能做什麼。 */
  can?: CourseCan;
};

export type MediaType = "demo" | "youtube" | "mux" | "audio";
export type Lesson = {
  id: string;
  position: number;
  title: string;
  minutes: number;
  completed: boolean;
  kind: "video" | "audio";
  /** 這一堂的活動日期（YYYY-MM-DD；沒有設定為 null）。 */
  eventDate: string | null;
  /** 這一堂的分享者（沒有填為空字串）。 */
  sharer: string;
  /** 分享者的獎銜（中央獎銜代碼）與顯示名稱、職稱。 */
  sharerRank: string;
  sharerRankName: string;
  sharerTitle: string;
  /** 內容已準備好（已上傳影片／音檔或設定好來源）；false＝敬請期待。 */
  ready: boolean;
  /** 時間軸分段（秒）：同一支影片切成多堂時使用；null 表示從頭／播到結束。 */
  start: number | null;
  end: number | null;
  /** locked＝尚未報名（或不符資格），不能觀看。 */
  locked: boolean;
  /** 「完整版」（同一支影片被裁成多段時自動多出的整支播放區塊），不列入章節總數與學習進度。 */
  full?: boolean;
  /** 「其他教材」（不計入章節堂數與學習進度）。序號 position 與章節各自從 1 開始。 */
  material?: boolean;
  /** 素材的「分類區域標題」（沒有內容，只是一個可收合的標題；杜杜龍 2026-11-17）。 */
  section?: boolean;
  /** 區塊（section）專用（杜杜龍 2026-11-18）：顯示在上一層上拉選單、分類（「、」分隔，可複選）、品牌（單選）、沒上傳封面時的品牌 logo 封面。 */
  inSheet?: boolean;
  /** 連結區塊（品牌資訊卡的「新品特惠培訓直播」）：內容與封面都來自另一份清單的區塊（杜杜龍 2026-11-18）。 */
  linkedCourseId?: string;
  linkedBlockId?: string;
  /** 區塊照片：放這個區塊照片的區塊編號（連結區塊＝來源區塊）；沒有這個欄位＝這門課沒開放區塊照片。 */
  /** 連結區塊（品牌卡的「成交百寶箱」）的來源課程對你鎖住：教材與照片要蓋鎖頭遮罩；lockLines＝遮罩文字（原因）。 */
  blockLocked?: boolean;
  lockLines?: string[];
  /** 區塊照片張數（鎖住時 photos 是空的，張數仍照給）。 */
  photoCount?: number;
  photoKey?: string;
  /** 區塊照片清單（依排序）。 */
  photos?: CoverMediaItem[];
  /** 這個項目實際屬於哪份清單（連結區塊裡的項目才有）；編輯、排序都在原清單。 */
  courseId?: string;
  categories?: string;
  brandId?: string | null;
  brandName?: string | null;
  brand?: BrandCover | null;
  /** 章節自己的封面：橫式 16:9（清單縮圖）與直式；沒設定為 null（改用課程封面）。 */
  coverUrl?: string | null;
  /** true＝coverUrl 不是上傳的，是 YouTube 縮圖（杜杜龍 2026-11-25）；編輯畫面不可把它當成已上傳的封面。 */
  coverAuto?: boolean;
  posterUrl?: string | null;
  /** 章節日期是否「跟著課程日期」（沒有自己設定日期）；eventDate 已是算好的實際日期。 */
  dateFollows?: boolean;
  /** 主講人章節（同一門課最多一堂，只有章節有）：「單元」頁的「只顯示主講人」只列這一堂。 */
  isSpeaker?: boolean;
  /** 總結與銷售課程（每門課最多一堂，與主講人互斥；用於「全部課程 > 單元」篩選）。 */
  isSummary?: boolean;
  /** 其他教材的外部連結：類型（畫面用官方 Logo）與網址。網址只給有權限看的人（鎖定的課程不給）；沒有連結（舊教材、完整版）沒有這兩個欄位。 */
  linkType?: AttachmentType;
  /** 項目圖示的類型（連結類型；清單裡的 YouTube 影片也是 youtube）。畫面一律用 BrandIcon 顯示。 */
  iconType?: AttachmentType;
  linkUrl?: string;
  /** 只有管理員會拿到（編輯影片來源用）。 */
  media?: { type: MediaType; ref: string | null };
};
export type CourseDetail = CourseSummary & {
  description: string;
  lessons: Lesson[];
  /** 只有管理員會拿到。 */
  admin?: {
    hostCenterKey: string | null;
    freeFrom: string | null;
    freeUntil: string | null;
    reviewGroupId: string | null;
    basePriceTwd: number;
    /** 這位管理者能做什麼。 */
    can: CourseCan;
    /** 有效報名數（已開通、免費報名、待審核；不含已退回）：大於 0 時「刪除」改為「下架封存」。 */
    registrations: number;
    /** 最後修改者與時間（顯示在進階設定最下方）。 */
    editedByName: string;
    editedAt: string | null;
    /** 儲存時帶回做「別人剛改過」檢查。 */
    updatedAt: string;
    /** 是這位管理者自己新增的課程。 */
    mine: boolean;
  };
};

export type OrderStatus = "pending" | "opened" | "rejected";
export type ReviewAction = "paid" | "vip" | "reject" | "defer" | "revoke";
export const REVIEW_REASONS = {
  unpaid: "款項未入帳",
  wrong_amount: "款項金額不正確",
  rank: "獎銜不符合",
  unknown_member: "查無此人，請到會員中心補填個人資料",
  other: "其他原因",
} as const;
export type ReviewReason = keyof typeof REVIEW_REASONS;
export type OrderEvent = {
  id: string;
  action: "submit" | ReviewAction | "message" | "note";
  actorName: string;
  actorTitle: string;
  mine: boolean;
  reason: string | null;
  message: string;
  /** 私人備註：只有審核人員會拿到。 */
  note?: string;
  createdAt: string;
};
/** 報名名單（杜杜龍 2026-11-20）：每位報名學員一列；上手白金／上手鑽石由中央即時提供（行動大學不保存），讀不到就是 null。 */
export type RosterRow = {
  orderId: string;
  name: string;
  center: string;
  /** free＝免費報名；paid＝付費報名；invite＝邀請碼加入；invite_request＝按「無邀請碼」申請。 */
  method: "free" | "paid" | "invite" | "invite_request" | "batch";
  status: "opened" | "pending" | "rejected";
  createdAt: string;
  uplinePlatinum: string | null;
  uplineDiamond: string | null;
};
export type Roster = {
  rows: RosterRow[];
  total: number;
  counts: { all: number; pending: number; invite: number; opened: number };
  page: number;
  pageSize: number;
  /** 中央有沒有回應上手資料（false＝這一頁的上手欄位顯示「未提供」）。 */
  uplineAvailable: boolean;
  /** 讀不到上手資料的原因（狀態碼或錯誤代碼，除錯用）。 */
  uplineError?: string;
};
/** 系列「套用到全系列課程」（杜杜龍 2026-11-20）：可以套用的欄位（鍵＝課程儲存 API 的欄位名），依課程設定的大項分組；新增欄位只加在這一張表。 */
export const SERIES_APPLY_GROUPS = [
  { key: "basics", label: "基本資料", fields: ["category", "brandId", "isPackage"] },
  { key: "when", label: "時間與地點", fields: ["location", "locationNone", "isOnline"] },
  { key: "price", label: "費用與審核", fields: ["priceTwd", "priceTba", "diamondFree"] },
  { key: "enroll", label: "報名資格條件", fields: ["viewScope", "minRankCode", "allowPresident", "inviteOnly", "inviteCode"] },
  { key: "advanced", label: "進階設定", fields: ["hostUnit", "chapterCovers"] },
  { key: "status", label: "上架與刪除", fields: ["status"] },
] as const;
export const SERIES_APPLY_FIELDS: string[] = SERIES_APPLY_GROUPS.flatMap((g) => [...g.fields]);
/** 已經有人報名的課程不會被改到的欄位（費用）。 */
export const SERIES_PRICE_FIELDS = ["priceTwd", "priceTba", "diamondFree"];
/** 套用預覽：每門課會改哪些欄位、哪些被略過（為什麼）。 */
export type SeriesApplyPlan = { courses: { id: string; title: string; apply: string[]; skipped: { key: string; reason: string }[] }[]; fields: string[] };
export type SeriesApplyResult = { applied: number; failed: { id: string; title: string; error: string }[] };
export type SeriesRosterPlan = { source: { id: string; title: string; members: number }; targets: { id: string; title: string; add: number; already: number; skipped: string | null }[]; totalAdd: number };
/** 課程管理者看到的邀請設定。 */
export type InviteInfo = { inviteOnly: boolean; code: string };
export type Order = {
  id: string;
  status: OrderStatus;
  deferred: boolean;
  revoked: boolean;
  totalTwd: number;
  paidTwd: number | null;
  payMethod: "cash" | "transfer" | "vip" | "online" | "free" | null;
  /** 報名方式：空＝一般；invite＝邀請碼加入；invite_request＝無邀請碼、等候人工審核。 */
  joinMethod: "" | "invite" | "invite_request";
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  memberName: string;
  /** 付費報名當下的真實姓名快照（對帳用；只有本人與審核人員／管理員看得到）。 */
  legalName?: string | null;
  /** 付款代碼（付費報名才有）：匯款備註填寫，對帳以代碼為準。 */
  payRef?: string | null;
  /** 會員 ID（對方改名後仍可用它認出同一個人）。 */
  memberSub?: string;
  centerLabel: string;
  hglobal: boolean;
  /** series／eventStart／eventEnd／place：給學員在報名明細核對是哪一場（place＝地點，線上課程顯示「線上課程」，沒有就是 null）。 */
  items: { courseId: string; title: string; priceTwd: number; series: string; eventStart: string | null; eventEnd: string | null; place: string | null }[];
  /** 以下只在單筆明細提供。 */
  events?: OrderEvent[];
  /** 這位學員所屬中心的收費窗口姓名。 */
  collectors?: string[];
  /** 這場活動的負責審核人員姓名（同一個審核群組、同一中心）。 */
  reviewers?: string[];
  /** 學員回報的繳費方式紀錄（新的在後）。 */
  payments?: PaymentReport[];
  canReview?: boolean;
  canRevoke?: boolean;
};
