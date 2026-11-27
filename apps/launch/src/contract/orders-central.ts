/** 前後端共用的資料格式：報名繳費方式、職務名稱、中央審核（杜杜龍 2026-11-27 從 contract.ts 依功能拆出；contract.ts 會全部轉出，舊的 import 不用改）。 */

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

/** 通知分類（通知頁的檢視模式：全部／審核／訂閱／留言；杜杜龍 2026-11-17）。 */
export type NoticeCategory = "review" | "subscribe" | "comment" | "achievement" | "other";
/** pending＝審核相關而且還沒處理（杜杜龍 2026-11-23：通知頁一律置頂）：待審的報名通知＝那筆報名還在待審；其他審核通知＝還沒讀。 */
export type Notice = { id: string; title: string; body: string; link: string; read: boolean; createdAt: string; category: NoticeCategory; pending?: boolean };

/** 中央的一筆「獎銜、中心」新申請（只即時顯示，不保存）。 */
export type CentralReview = { id: string; /** 申請人（只在審核者本人開啟時即時讀取，不保存）。 */ member_id?: string; display_name: string | null; /** 申請人本名與上手（中央即時提供，不保存；讀不到就沒有）。 */ legal_name?: string | null; upline_platinum?: string | null; upline_diamond?: string | null; field_key: string; field_label: string; center: string | null; current_value: unknown; requested_value: unknown; created_at: string };
/** available＝false：這位會員沒有審核權限、或中央暫時不可用（畫面直接不顯示審核區）。 */
/** App 內指派職務（杜杜龍 2026-11-21，中央串接指令 2026-11-21.1）：職務選項一律用中央回傳的 assignable_roles，不寫死。 */
export type CoverMediaKind = "center" | "series" | "course";
/** 儲存區（杜杜龍 2026-11-23）：cover＝封面編輯上傳的封面輪播照片；edm＝中心「EDM」分頁的照片。兩邊各自獨立，張數不設上限（杜杜龍 2026-11-25）；系列、課程只有 cover。 */
export type CoverScope = "cover" | "edm";
/** 「相簿」專區（杜杜龍 2026-11-25）：自動彙整全站所有用到相簿上傳功能的照片，依來源分成「資料夾」。 */
export type AlbumFolder = { /** 唯一識別：來源類型＋鍵值（＋儲存區）。 */ id: string; /** center＝中心；series＝系列；course＝課程封面；block＝課程區塊相簿（點開前往該課程的相簿分頁）。 */ kind: "center" | "series" | "course" | "block"; /** center／series／course 用 /cover-media 讀；block 用課程編號＋區塊編號前往課程頁。 */ key: string; scope?: CoverScope; title: string; subtitle?: string; count: number; thumb: string | null; /** 資料夾預覽用的前 4 張縮圖。 */ thumbs: string[]; courseId?: string; /** 沒有權限進入（鎖定的課程、區塊相簿）：禁止進入，點了只顯示原因。 */ locked: boolean; lockReason?: string; /** 所屬大類別代碼（edm／cover／series／course／block／treasure）。 */ groupId: string; /** 看的人可不可以在這個資料夾上傳照片（伺服器上傳時仍會再檢查）。 */ canEdit: boolean };
