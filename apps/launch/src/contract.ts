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

/** 沒有系列的課程卡一律放進這個系列：只有超級管理員看得到（業主 2026-11-19）。清單卡沒有系列照舊直接在第一層。 */
export const UNCATEGORIZED = "未分類";
/** 系列的設定（標題只改顯示，不動識別名稱 series）。 */
export type SeriesSetting = { series: string; title: string; showInAll: boolean };

export type EnrollmentState = "opened" | "pending" | null;

/**
 * 固定格式的文字封面（業主 2026-11-19）：名稱以這些字開頭的課程，封面一律只有文字＋咖啡色系底，且固定「名稱（換行）X年X月」兩行，
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
/** 寰宇大學「所有系列」檢視的三個專區（業主 2026-11-18）。空字串＝沒指定：課程放 hglobal、清單放 amway_material。 */
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
  /** 套裝課程（業主 2026-11-19）：只是分類篩選用途，不改變版面與功能；日期區間 7 天以上時編輯畫面會自動勾選。 */
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
  /** 品牌（業主 2026-11-18，獨立於分類）：brand_logos 的 id 與名稱。 */
  brandId: string | null;
  brandName: string | null;
  /** 所屬專區（業主 2026-11-18）。 */
  zone: Zone;
  /** 選了品牌、且沒有手動上傳封面時才有：logo 圖、底色、底圖。 */
  brand: BrandCover | null;
  /** 清單類別：勾了「顯示在上拉選單」的區塊（業主 2026-11-18）；課程類別永遠是空陣列。 */
  blocks: { id: string; title: string; coverUrl: string | null; brand: BrandCover | null; count: number; categories: string; brandId: string | null }[];
  /** 系列內的手動順序（0＝還沒排過；沒排過的新卡自動排最前面）。 */
  seriesOrder: number;
  /** 在系列頁隱藏（業主 2026-11-19）：只是不在系列頁顯示，仍可用網址、搜尋、單元找到。 */
  seriesHidden: boolean;
  /** 素材（教材）數量：有影音來源或外部連結的項目數（清單卡的上拉選單標籤用）。 */
  materialCount: number;
  totalMinutes: number;
  eligible: boolean;
  /** 會長不受獎銜限制也可報名。 */
  allowPresident: boolean;
  /** 指定邀請制（業主 2026-11-20）：不看獎銜、一律人工審核；inviteHasCode＝有設邀請碼（輸入正確免審核）。邀請碼本身只給課程管理者（GET /admin/courses/:id/invite）。 */
  inviteOnly: boolean;
  inviteHasCode: boolean;
  /** 這位登入者能不能看這門課的報名名單（管理者、有審核權限的人；業主 2026-11-20）。 */
  canRoster: boolean;
  /** 指導單位、主辦單位（空字串表示未設定）。 */
  guidanceUnit: string;
  hostUnit: string;
  /** 活動日期（YYYY-MM-DD）；eventEnd 只有連續多天的活動才有（天數不設上限）。 */
  eventStart: string | null;
  eventEnd: string | null;
  /** 完全公開：未登入的訪客也能瀏覽介紹與章節、觀看（只限免費課程）。 */
  isPublic: boolean;
  /** 誰可以瀏覽（業主 2026-11-17）。 */
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
  /** 中心課程：只在「寰宇教育中心」頁出現，不在「全部課程」出現。 */
  centerCourse: boolean;
  /** 短影音專輯：這門課的章節與影音教材在「單元」頁歸類為短影音。 */
  isShorts: boolean;
  /** 清單卡（業主 2026-11-16）：只有「其他教材」，沒有章節、時間地點、費用、主講人；影片教材在 App 內播放並計入學習進度。 */
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
  /** 素材的「分類區域標題」（沒有內容，只是一個可收合的標題；業主 2026-11-17）。 */
  section?: boolean;
  /** 區塊（section）專用（業主 2026-11-18）：顯示在上一層上拉選單、分類（「、」分隔，可複選）、品牌（單選）、沒上傳封面時的品牌 logo 封面。 */
  inSheet?: boolean;
  /** 連結區塊（品牌資訊卡的「新品特惠培訓直播」）：內容與封面都來自另一份清單的區塊（業主 2026-11-18）。 */
  linkedCourseId?: string;
  linkedBlockId?: string;
  /** 這個項目實際屬於哪份清單（連結區塊裡的項目才有）；編輯、排序都在原清單。 */
  courseId?: string;
  categories?: string;
  brandId?: string | null;
  brandName?: string | null;
  brand?: BrandCover | null;
  /** 章節自己的封面：橫式 16:9（清單縮圖）與直式；沒設定為 null（改用課程封面）。 */
  coverUrl?: string | null;
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
/** 報名名單（業主 2026-11-20）：每位報名學員一列；上手白金／上手鑽石由中央即時提供（行動大學不保存），讀不到就是 null。 */
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
/** 系列「套用到全系列課程」（業主 2026-11-20）：可以套用的欄位（鍵＝課程儲存 API 的欄位名），依課程設定的大項分組；新增欄位只加在這一張表。 */
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

export const PAYMENT_METHODS = [
  { key: "cash", label: "現金" },
  { key: "linepay", label: "LINE Pay" },
  { key: "transfer", label: "網銀轉帳" },
  { key: "friend", label: "託朋友代付" },
] as const;
export type PaymentMethodKey = (typeof PAYMENT_METHODS)[number]["key"];
export type PaymentReport = { id: string; method: PaymentMethodKey; last5: string | null; friendName: string | null; paidAt: string | null; createdAt: string };

export type Duty = "register" | "collect" | "review";
export const DUTY_LABELS: Record<Duty, string> = { register: "報名窗口", collect: "收費窗口", review: "審核員" };
export type ReviewGroup = {
  id: string;
  name: string;
  /** null＝總部群組（只有秘書與超級管理員可管理）。 */
  ownerCenter: string | null;
  courses: { id: string; title: string }[];
  members: { centerKey: string; centerLabel: string; memberSub: string; memberName: string; duty: Duty }[];
  canManage: boolean;
};

/** 通知分類（通知頁的檢視模式：全部／審核／訂閱／留言；業主 2026-11-17）。 */
export type NoticeCategory = "review" | "subscribe" | "comment" | "other";
/** pending＝審核相關而且還沒處理（業主 2026-11-23：通知頁一律置頂）：待審的報名通知＝那筆報名還在待審；其他審核通知＝還沒讀。 */
export type Notice = { id: string; title: string; body: string; link: string; read: boolean; createdAt: string; category: NoticeCategory; pending?: boolean };

/** 中央的一筆「獎銜、中心」新申請（只即時顯示，不保存）。 */
export type CentralReview = { id: string; /** 申請人（只在審核者本人開啟時即時讀取，不保存）。 */ member_id?: string; display_name: string | null; /** 申請人本名與上手（中央即時提供，不保存；讀不到就沒有）。 */ legal_name?: string | null; upline_platinum?: string | null; upline_diamond?: string | null; field_key: string; field_label: string; center: string | null; current_value: unknown; requested_value: unknown; created_at: string };
/** available＝false：這位會員沒有審核權限、或中央暫時不可用（畫面直接不顯示審核區）。 */
/** App 內指派職務（業主 2026-11-21，中央串接指令 2026-11-21.1）：職務選項一律用中央回傳的 assignable_roles，不寫死。 */
/** 每個封面（中心、課程、系列）最多放幾張照片／影片（業主 2026-11-21）。 */
export const COVER_MEDIA_MAX = 100;
export type CoverMediaKind = "center" | "series" | "course";
/** 儲存區（業主 2026-11-23）：cover＝封面編輯上傳的封面輪播照片；edm＝中心「EDM」分頁的照片。兩邊各自獨立，上限各 100 張；系列、課程只有 cover。 */
export type CoverScope = "cover" | "edm";
/** 封面輪播／相簿的一個項目：image 或短影音；width／height 為 0＝尺寸未知（當橫式）。 */
export type CoverMediaItem = { id: string; scope: CoverScope; /** 綁定的課程（課程 EDM 併入中心 EDM 空間；綁定的照片不能刪，只能更換）。 */ courseId?: string | null; courseTitle?: string | null; kind: "image" | "video"; url: string; posterUrl: string | null; width: number; height: number; durationSec: number; /** 中心 EDM：AI 辨識出的活動日期（YYYY-MM-DD）與海報文字（搜尋用）；還沒辨識完是 null／空字串。 */ eventDate?: string | null; text?: string };
/** 縮圖符號（業主 2026-11-23）：系列卡、課程卡、中心卡的小縮圖。symbol＝emoji 或短文字（最多 4 個字）；fg 文字色、bg 底色（#RRGGBB）。 */
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
type Segment = { start: number | null; end: number | null; resumeAt?: number };
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
export type BrandCover = { logoUrl: string; bgColor: string | null; /** 深色模式的底色（業主 2026-11-18）：使用者切換成深色模式時優先於底色與底圖；沒設定＝null。 */ bgColorDark: string | null; bgUrl: string | null };
/** 後台品牌 logo 管理用。 */
export type BrandLogo = { id: string; name: string; logoUrl: string | null; bgColor: string | null; bgColorDark: string | null; bgUrl: string | null };

/** 通知情境（Email 可逐項開關，業主 2026-11-18）：預設只有「付費課程相關的審核通知」要寄 Email，其餘預設不寄；手機推播不看這個，全部都推。 */
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
  fields: Record<"education_system" | "education_center" | "rank", { value: string; pending: string | null; status: string }>;
  rankOptions: { value: string; label: string }[];
};

// ---------- 學習成就（徽章）----------
export type AchievementType = "lessons_completed" | "courses_completed" | "courses_enrolled" | "learning_days" | "comments_posted" | "course_completed" | "streak_days" | "watch_minutes" | "centers_subscribed" | "series_subscribed" | "categories_explored" | "early_lessons" | "night_lessons" | "weekend_lessons" | "lessons_in_a_day" | "feature_used" | "subscriptions_total" | "material_video" | "lists_created" | "list_people" | "files_downloaded" | "target_lesson" | "series_completed";
/** 任務分類（後台「徽章任務設定」用，業主 2026-11-18）。 */
export type AchievementCategory = "progress" | "habit" | "time" | "explore" | "social" | "subscribe" | "feature" | "zone" | "list";
export const ACHIEVEMENT_CATEGORIES: { key: AchievementCategory; label: string; icon: string; desc: string }[] = [
  { key: "progress", label: "學習進度", icon: "📈", desc: "學了多少：完成的堂數、課程、學習時間" },
  { key: "habit", label: "學習習慣", icon: "🔥", desc: "有沒有持續：累計天數、連續天數" },
  { key: "time", label: "學習時段", icon: "🕒", desc: "什麼時候學：早晨、夜間、週末" },
  { key: "explore", label: "探索嘗鮮", icon: "🧭", desc: "報名多少門課、涉獵多少種分類" },
  { key: "social", label: "社群互動", icon: "💬", desc: "在課程留言板的互動" },
  { key: "subscribe", label: "訂閱關注", icon: "🔔", desc: "訂閱中心、系列的數量" },
  { key: "feature", label: "功能體驗", icon: "🧰", desc: "第一次使用某個網站功能（新手教學）" },
  { key: "list", label: "我的清單", icon: "📋", desc: "建立自己的清單、分享給別人、清單被多少人點閱" },
  { key: "zone", label: "清單影片", icon: "🎬", desc: "安麗官方資源、安麗品牌館：每個區塊隨機挑 1～2 支影片，讀完（看完）就解鎖" },
];
/** 條件類型：中文名稱、單位、分類、白話說明（後台挑選時顯示）。retired＝已停用的類型，後台不再提供。 */
export const ACHIEVEMENT_TYPES: Record<AchievementType, { label: string; unit: string; category: AchievementCategory; hint: string; needsCourse?: boolean; needsFeature?: boolean; retired?: boolean; auto?: boolean }> = {
  lessons_completed: { label: "累計完成章節數", unit: "堂", category: "progress", hint: "會員一共完成了幾個章節（每個章節只算一次）" },
  courses_completed: { label: "累計學完課程數", unit: "門", category: "progress", hint: "整門課的每個章節都完成，才算學完 1 門" },
  lessons_in_a_day: { label: "單日最多完成章節數", unit: "堂", category: "progress", hint: "同一天（台灣時間）內完成的章節數，取最高的一天" },
  watch_minutes: { label: "累計學習分鐘數", unit: "分鐘", category: "progress", hint: "把完成章節的長度加總（分鐘）" },
  learning_days: { label: "累計學習天數", unit: "天", category: "habit", hint: "有完成章節的不同日期共幾天（不需連續）" },
  streak_days: { label: "連續學習天數", unit: "天", category: "habit", hint: "連續幾天每天都有完成章節；太久很難達成，建議最多 7 天" },
  early_lessons: { label: "早晨完成章節數", unit: "堂", category: "time", hint: "04:00～08:00（台灣時間）完成的章節數" },
  night_lessons: { label: "夜間完成章節數", unit: "堂", category: "time", hint: "22:00～04:00（台灣時間）完成的章節數" },
  weekend_lessons: { label: "週末完成章節數", unit: "堂", category: "time", hint: "星期六、日完成的章節數" },
  courses_enrolled: { label: "累計報名課程數", unit: "門", category: "explore", hint: "已開通（含免費自動通過）的不同課程數" },
  categories_explored: { label: "學習過的不同分類數", unit: "種", category: "explore", hint: "完成過章節的課程，涵蓋幾種不同的分類" },
  comments_posted: { label: "課程留言次數", unit: "次", category: "social", hint: "在課程留言板留言的總次數" },
  centers_subscribed: { label: "訂閱中心數", unit: "個", category: "subscribe", hint: "按過訂閱鈴鐺的教育中心數量" },
  series_subscribed: { label: "訂閱系列數", unit: "個", category: "subscribe", hint: "按過訂閱鈴鐺的系列數量" },
  subscriptions_total: { label: "訂閱總數（中心＋系列）", unit: "個", category: "subscribe", hint: "中心與系列加起來的訂閱數量" },
  feature_used: { label: "使用過某個網站功能", unit: "次", category: "feature", hint: "第一次用到指定功能就達成（需要選功能），達成數量通常填 1", needsFeature: true },
  lists_created: { label: "累計建立清單數", unit: "份", category: "list", hint: "會員自己建立的「我的清單」份數（刪除後不算）" },
  list_people: { label: "單一清單被點閱的人數", unit: "人", category: "list", hint: "自己的清單裡，人氣最高的那份被不同的人點開過幾人（自己看不算）" },
  files_downloaded: { label: "下載教材檔案數", unit: "個", category: "feature", hint: "下載過幾個不同的教材檔案（同一個檔案下載多次只算一次）" },
  material_video: { label: "讀完指定的清單影片", unit: "支", category: "zone", hint: "由系統從清單專區、品牌專區隨機抽選影片產生（在「清單影片」分類按「重新抽選」），不能手動新增", auto: true },
  course_completed: { label: "學完指定的課程卡", unit: "門", category: "progress", hint: "指定的那張課程卡，每個章節都完成才算", needsCourse: true },
  target_lesson: { label: "完成指定的教材或章節", unit: "堂", category: "progress", hint: "指定的那個章節（或有影片的教材）看完就達成" },
  series_completed: { label: "學完指定系列卡內的課程", unit: "門", category: "progress", hint: "指定系列裡，學完幾門課程卡就達成" },
};

// ---------- 成就產生器（業主 2026-11-22）：動詞＋對象＋時段＋數量＋單位，全部用下拉選單點選 ----------
/** 時段限制（只有「完成章節」可選）。 */
export type AchTime = "any" | "early" | "night" | "weekend" | "day";
export const ACH_TIMES: { key: AchTime; label: string }[] = [
  { key: "any", label: "不限時段" },
  { key: "early", label: "早晨（04–08 點）" },
  { key: "night", label: "夜間（22–04 點）" },
  { key: "weekend", label: "週末" },
  { key: "day", label: "同一天內" },
];
/** 量化單位可選清單。 */
export const ACH_UNITS = ["堂", "門", "天", "分鐘", "次", "個", "份", "人", "種", "支"] as const;
export type AchObject = {
  name: string;
  unit: string;
  /** 這個「動詞＋對象」對應的條件類型（有時段選項的改看 times）。 */
  type?: AchievementType;
  times?: Partial<Record<AchTime, AchievementType>>;
  /** 固定的網站功能（例如分享）；pickFeature＝讓管理員從功能清單自己挑。 */
  feature?: string;
  pickFeature?: boolean;
  /** 要先搜尋並指定一個目標：lesson＝教材／章節、course＝課程卡、series＝系列卡。 */
  target?: "lesson" | "course" | "series";
  /** 達成數量固定為 1（不顯示數量與單位）。 */
  fixedOne?: boolean;
};
/** 動詞清單：icon＝這個動詞的預設徽章圖示（同動詞的成就全站一致）。新增動詞只要在這裡加一行。 */
export const ACH_VERBS: { verb: string; icon: string; objects: AchObject[] }[] = [
  { verb: "完成", icon: "✅", objects: [{ name: "章節", unit: "堂", times: { any: "lessons_completed", early: "early_lessons", night: "night_lessons", weekend: "weekend_lessons", day: "lessons_in_a_day" } }] },
  { verb: "學完", icon: "🎓", objects: [{ name: "課程", unit: "門", type: "courses_completed" }] },
  { verb: "報名", icon: "📝", objects: [{ name: "課程", unit: "門", type: "courses_enrolled" }] },
  { verb: "累計學習", icon: "📚", objects: [{ name: "時間", unit: "分鐘", type: "watch_minutes" }, { name: "天數", unit: "天", type: "learning_days" }] },
  { verb: "連續學習", icon: "🔥", objects: [{ name: "天數", unit: "天", type: "streak_days" }] },
  { verb: "涉獵", icon: "🧭", objects: [{ name: "分類", unit: "種", type: "categories_explored" }] },
  { verb: "留言", icon: "💬", objects: [{ name: "課程留言板", unit: "次", type: "comments_posted" }] },
  { verb: "訂閱", icon: "🔔", objects: [{ name: "中心", unit: "個", type: "centers_subscribed" }, { name: "系列", unit: "個", type: "series_subscribed" }, { name: "中心＋系列", unit: "個", type: "subscriptions_total" }] },
  { verb: "使用", icon: "🧰", objects: [{ name: "指定功能", unit: "次", type: "feature_used", pickFeature: true }] },
  { verb: "建立", icon: "📋", objects: [{ name: "清單", unit: "份", type: "lists_created" }] },
  { verb: "被點閱", icon: "👀", objects: [{ name: "我的清單", unit: "人", type: "list_people" }] },
  { verb: "分享", icon: "📤", objects: [{ name: "給朋友", unit: "次", type: "feature_used", feature: "share" }, { name: "我的清單", unit: "次", type: "feature_used", feature: "list_share" }] },
  { verb: "指定學習", icon: "🎯", objects: [{ name: "教材", unit: "堂", type: "target_lesson", target: "lesson", fixedOne: true }, { name: "課程卡", unit: "門", type: "course_completed", target: "course", fixedOne: true }, { name: "系列卡", unit: "門", type: "series_completed", target: "series" }] },
  { verb: "下載", icon: "📥", objects: [{ name: "教材檔案", unit: "個", type: "files_downloaded" }] },
];
/** 圖示圖庫（「隨機」與「自選」用）。 */
export const ACH_ICON_POOL = ["🏅", "🔥", "🌱", "📚", "🎓", "🔔", "💬", "⭐", "🌟", "🏆", "🚀", "💎", "🎯", "🧭", "🍀", "🎖️"] as const;
/** 動詞＋對象＋時段＋功能 → 條件類型（算不出來回 null）。 */
export function achTypeOf(vi: number, oi: number, time: AchTime): AchievementType | null {
  const o = ACH_VERBS[vi]?.objects[oi];
  if (!o) return null;
  return o.times ? (o.times[time] ?? o.times.any ?? null) : (o.type ?? null);
}
/** 反查：條件類型（與功能）＝哪個動詞、對象、時段；清單影片、指定課程這類沒有對應回 null。 */
export function achRecipeOf(type: AchievementType, feature?: string | null): { vi: number; oi: number; time: AchTime } | null {
  let loose: { vi: number; oi: number; time: AchTime } | null = null;
  for (let vi = 0; vi < ACH_VERBS.length; vi++) {
    const objs = ACH_VERBS[vi]!.objects;
    for (let oi = 0; oi < objs.length; oi++) {
      const o = objs[oi]!;
      if (o.times) {
        for (const t of Object.keys(o.times) as AchTime[]) if (o.times[t] === type) return { vi, oi, time: t };
      } else if (o.type === type) {
        if (o.feature) {
          if (o.feature === feature) return { vi, oi, time: "any" };
        } else if (o.pickFeature) loose ??= { vi, oi, time: "any" };
        else return { vi, oi, time: "any" };
      }
    }
  }
  return loose;
}
/** 預設徽章圖示（依動詞）。 */
export const achDefaultIcon = (vi: number) => ACH_VERBS[vi]?.icon ?? "🏅";
/** 徽章圖固定用圖片時的代碼（存在 achievements.icon）：畫面用圖片、通知文字退回 🏅。 */
export const BADGE_IMAGE_ICONS = ["@amway"] as const;
export const isImageIcon = (icon: string) => (BADGE_IMAGE_ICONS as readonly string[]).includes(icon);
/** 通知、純文字場合用的圖示（圖片徽章退回 🏅）。 */
export const iconText = (icon: string) => (isImageIcon(icon) ? "🏅" : icon);
/** 網站功能清單（功能體驗徽章，類似新手教學）：key 是前端回報用的代碼，label 是功能名稱，hint 是怎麼用。 */
export const FEATURES = {
  share: { label: "分享給朋友", hint: "在課程、章節或海報按分享鈕，傳給朋友" },
  copy_link: { label: "複製連結", hint: "分享時選擇複製連結" },
  download_image: { label: "下載海報圖片", hint: "放大海報後按下載" },
  edm_zoom: { label: "放大看海報", hint: "點課程或中心的海報放大，可兩指縮放" },
  player_speed: { label: "調整播放速度", hint: "播放章節時，點控制列的速度鈕" },
  video_zoom: { label: "影片拖曳縮放", hint: "播放時用兩指放大縮小影片" },
  open_material: { label: "開啟其他教材", hint: "點課程頁的簡報、文件等外部連結" },
  push_enable: { label: "開啟手機推播", hint: "設定 > 通知設定，打開手機推播" },
  notify_settings: { label: "調整通知設定", hint: "設定 > 通知設定，改 Email 通知等" },
  search: { label: "使用搜尋", hint: "在寰宇大學點放大鏡搜尋課程或章節" },
  view_mode: { label: "切換瀏覽模式", hint: "在寰宇大學切換系列、單元、教育中心" },
  profile_edit: { label: "更新個人資料", hint: "設定頁點自己的資料，修改後儲存" },
  orders_view: { label: "查看訂單紀錄", hint: "設定 > 訂單紀錄" },
  achievements_view: { label: "查看學習成就", hint: "學習中頁點學習成就" },
  sapling_tap: { label: "點小樹苗", hint: "學習中頁點小樹苗，看累計幾棵" },
  bookshelf_view: { label: "打開我的書櫃", hint: "設定 > 我的書櫃" },
  center_page: { label: "逛中心專屬頁", hint: "在寰宇大學選一個中心" },
  series_page: { label: "逛系列頁", hint: "在寰宇大學進入一個系列" },
  subscribe: { label: "訂閱中心或系列", hint: "在中心頁或系列頁按訂閱鈴鐺" },
  broadcast_open: { label: "查看廣播公告", hint: "點中心頁的黃色公告橫條" },
  notices_filter: { label: "切換通知分類", hint: "通知頁切換全部、審核、訂閱、留言" },
  list_create: { label: "建立我的清單", hint: "按「加入清單」鈕，新增一份自己的清單" },
  list_add: { label: "加入我的清單", hint: "把課程、教材、系列或中心加入自己的清單" },
  list_share: { label: "分享我的清單", hint: "在「我的清單」按分享，把清單網址傳給朋友" },
  list_copy: { label: "複製別人的清單", hint: "打開朋友分享的清單，按「複製到我的清單」" },
} as const;
export type FeatureKey = keyof typeof FEATURES;
/** 會員看到的徽章：已取得或尚未取得（含目前進度）。 */
export type Achievement = {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: AchievementType;
  threshold: number;
  feature?: string | null;
  /** 量化單位（堂、天、次…；後台自選，空白時用條件類型的預設單位）。 */
  unit?: string | null;
  /** 指定系列卡的名稱（series_completed）。 */
  series?: string | null;
  /** 清單影片徽章：指定的影片名稱與所屬清單。 */
  lessonTitle?: string | null;
  courseTitle: string | null;
  current: number;
  earned: boolean;
  earnedAt: string | null;
};
/** 超級管理員設定徽章用。 */
export type AdminAchievement = {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: AchievementType;
  threshold: number;
  feature?: string | null;
  unit?: string | null;
  series?: string | null;
  courseId: string | null;
  courseTitle: string | null;
  /** 清單影片徽章指定的影片（章節編號與名稱）。 */
  lessonId?: string | null;
  lessonTitle?: string | null;
  active: boolean;
  earnedCount: number;
  /** 難易度 1～3 顆星（後台設定）。 */
  difficulty: 1 | 2 | 3;
  /** 目前有紀錄的會員總數（算「會員完成度」用，每一筆都帶同一個數字）。 */
  memberTotal: number;
};

/** 申請人顯示名稱：本名＋暱稱同時顯示，例如「王小明（小明）」；兩者相同或只有一個時只顯示一個。 */
export function applicantLabel(legalName: string | null | undefined, nickname: string | null | undefined): string {
  const legal = (legalName ?? "").trim();
  const nick = (nickname ?? "").trim();
  if (legal && nick && legal !== nick) return `${legal}（${nick}）`;
  return legal || nick;
}

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
  ribbons: Record<RibbonKey, { label: string; color: RibbonColor; enabled: boolean }>;
  /** 除了超級管理員、總部秘書之外，哪些職務可以看「統計分析」（職務代碼：president、sound、course、reviewer）。 */
  statsRoles: string[];
  /** APP 數值設定（超級管理員在「設定 > APP 數值設定」調整）：首頁推薦規則、輪播秒數、其他全站數值。 */
  app: AppSettings;
  /** 分享預設值（超級管理員在「設定 > 分享預設值」調整）：分享選單的文字、LINE 預覽卡片的標題與備註格式。 */
  share: ShareSettings;
};

/**
 * 分享預設值（業主 2026-11-16）：
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
  /** 分享「清單卡」（業主 2026-11-16：教材與課程分開設定）：清單頁右上角與課程列的分享，可用 {清單名稱}。 */
  listText: string;
  /** 分享清單卡裡的單一影片（每列右側的分享鈕，點開直接播放這一段）：可用 {影片名稱}、{清單名稱}。 */
  listItemText: string;
  /** 邀請特定會員擔任課程審核人員（24 小時有效的邀請網址）：可用 {課程名稱}；後面接 linkLead 與邀請網址。 */
  reviewerInviteText: string;
};
export const DEFAULT_SHARE_SETTINGS: ShareSettings = {
  inviteText: "分享給我的好朋友，這裡有好多精彩的免費講座與課程唷 ❤️",
  courseText: "我剛聽完這場 {主講人}{職稱}的這場精彩演講 {課程名稱} 我就立刻想到要分享給你！",
  linkLead: "按此開啟網址 👉",
  siteName: "寰宇行動大學",
  titleSeparator: " | ",
  addressIcon: "📍",
  showAddress: true,
  showQuote: true,
  hqName: "寰宇總部",
  fallbackDescription: "",
  materialText: "我推薦你看這份教材：{教材名稱}（{課程名稱}）",
  chapterText: "我剛聽完這場 {主講人}{職稱}的這場精彩演講 {章節名稱} 我就立刻想到要分享給你！",
  listText: "推薦你看「{清單名稱}」，裡面有好多精彩影片，一起來看吧！",
  listItemText: "我剛看完這段精彩影片「{影片名稱}」（{清單名稱}），立刻想到要分享給你！",
  reviewerInviteText: "邀請你擔任「{課程名稱}」的報名審核人員。請在 24 小時內點開下方網址並登入寰宇行動大學，按「接受」後就能審核這門課的報名。",
};

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
 * Cloudflare 即時縮圖的全部選項（業主 2026-11-20）：對應 Cloudflare Images 的參數。
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
};
export const THUMB_WIDTH_CHOICES = [240, 320, 480, 640, 800, 960, 1280, 1600];
/** 平板、電腦用的大尺寸（業主 2026-11-20）：固定可用，不必在設定頁勾選。 */
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
  /** 已有課程播放中又要播另一堂時，自動同意改播前的倒數秒數。 */
  switchCountdownSec: number;
  /** 圖片「完整顯示」合成封面時的背景模糊強度（數字越大越模糊）。 */
  blurStrength: number;
  /** 學習紀錄：播放超過這個比例（%）就算「開始學習」（課程列入「學習中」）。 */
  learnStartPct: number;
  /** 學習紀錄：播放超過這個比例（%）（或播到結尾）自動標記這一堂完成。 */
  learnDonePct: number;
  /** 學習紀錄：播放進度每次回報的最短間隔（秒）。 */
  watchReportSec: number;
  /** 集滿幾枚徽章自動解鎖「我的書櫃」鑰匙（業主 2026-11-18 起可在後台「徽章任務設定」調整）。 */
  libraryKeyBadges: number;
  /** 「我的清單」（業主 2026-11-21）：每位會員一開始能建立幾份清單，以及完成指定學習成就後各多解鎖幾份（設定頁「清單解鎖設定」）。 */
  listBaseQuota: number;
  listUnlocks: { achievementId: string; extra: number }[];
  /** 上傳檔案設定（業主 2026-11-18，在「儲存空間管理」調整）：單檔大小上限（MB）、圖片壓縮長邊（像素）與畫質（%）。 */
  fileMaxMb: number;
  imageMaxSide: number;
  imageQuality: number;
  /** 中心封面照片（中心首頁圖）的壓縮：長邊與畫質，比一般圖片更高（業主 2026-11-18）。 */
  centerMaxSide: number;
  centerQuality: number;
  /** EDM 海報原圖：長邊像素與畫質（小字與 QR code 要看得清楚，預設較高）。 */
  edmMaxSide: number;
  edmQuality: number;
  /** 封面輪播與短影音（業主 2026-11-21，在「儲存空間管理」同一區調整）：照片停留秒數、短影音壓縮規範（在上傳者的瀏覽器內壓縮）。 */
  coverSec: number;
  videoMaxHeight: number;
  videoKbps: number;
  videoFps: number;
  videoMaxMb: number;
  videoMaxSec: number;
  /** 所有上傳圖片存進雲端時統一轉成的格式（業主 2026-11-20；預設 JPEG，相容性最好）。 */
  storeFormat: "jpeg" | "webp" | "avif";
  /** Cloudflare 即時縮圖（業主 2026-11-20 小範圍試用）：封面縮圖的所有選項，在「設定 › Cloudflare即時縮圖」調整。 */
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
  switchCountdownSec: 15,
  blurStrength: 18,
  learnStartPct: 1,
  learnDonePct: 95,
  watchReportSec: 10,
  libraryKeyBadges: 100,
  listBaseQuota: 2,
  listUnlocks: [],
  fileMaxMb: 30,
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
  thumb: { enabled: false, widths: [320, 480, 640], height: 0, fit: "scale-down", gravity: "auto", format: "auto", quality: 70, qualityLevel: "", anim: true, metadata: "none", rotate: 0, flip: "", blur: 0, sharpen: 0, brightness: 1, contrast: 1, gamma: 1, saturation: 1, background: "", trim: 0, borderWidth: 0, borderColor: "#ffffff" },
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

// ---------- 我的書櫃（業主 2026-11-17） ----------
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
/** 集滿這麼多枚徽章就自動解鎖書櫃鑰匙（業主 2026-11-17）。 */
export const LIBRARY_KEY_BADGES = 100;
export type LibraryMine = { keys?: { have: number; need: number; blocked?: string }; library: null | { number: string; title: string; ownerName: string; views: number; pwSet: boolean; pwExpiresAt: string | null; pwExpired: boolean }; items: LibraryItem[] };
/** 公開檢視：locked＝整座書櫃要先輸入密碼（items 是空的）；owner＝正在看自己的書櫃。 */
export type LibraryView = { number: string; title: string; ownerName: string; locked: boolean; lockExpired: boolean; owner: boolean; items: LibraryItem[] };
export type LibraryUnlock = { token: string; until: number };

/**
 * 我的清單封面的漸層底色（業主 2026-11-22：會員不能上傳封面圖，只能選管理員的底圖或下面這些漸層）。
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
