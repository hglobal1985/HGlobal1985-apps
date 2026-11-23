import { Platform } from "react-native";
import type { OrderStatus } from "@/api/client";

export const ntd = (n: number) => `NT$${n.toLocaleString()}`;

/** 日期顯示一律不補 0：2026/11/8 7:30（分鐘仍保留兩位數，7:03 不能寫成 7:3）。 */
export function dateTime(isoText: string): string {
  const d = new Date(isoText);
  return `${dateOnly(isoText)} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 只顯示日期：2026/11/8（不補 0）。 */
export function dateOnly(isoText: string): string {
  const d = new Date(isoText);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** 「2026-11-08」→「2026/11/8」（不補 0）。 */
export function plainDate(ymd: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(ymd);
  return m ? `${Number(m[1])}/${Number(m[2])}/${Number(m[3])}` : ymd;
}

type Tone = "warning" | "success" | "danger" | "neutral";
export function orderStatus(o: { status: OrderStatus; deferred?: boolean; revoked?: boolean }): { label: string; tone: Tone } {
  if (o.revoked) return { label: "已撤銷", tone: "danger" };
  if (o.status === "opened") return { label: "已開通", tone: "success" };
  if (o.status === "rejected") return { label: "已退回", tone: "danger" };
  return o.deferred ? { label: "延後再審", tone: "neutral" } : { label: "待審核", tone: "warning" };
}
export const payMethodLabel: Record<string, string> = { cash: "現金", transfer: "轉帳", vip: "VIP 免繳費", online: "線上", free: "免費" };
export const eventLabel: Record<string, string> = { submit: "送出報名", paid: "確認已繳費，開通", vip: "VIP 免繳費，開通", reject: "退回", defer: "延後再審", revoke: "撤銷開通", message: "留言", note: "私人備註" };

/** 通知連結在 App 上若指向 Web 限定頁面（報名、審核），改帶到我的課程。 */
export function noticeTarget(link: string): string {
  if (Platform.OS !== "web" && (link.startsWith("/orders") || link.startsWith("/admin/orders"))) return "/learning";
  return link;
}

/** 日期時間輸入：「2026-12-01 19:30」⇄ ISO。空白回傳 null；格式錯誤回傳 undefined。 */
export function parseLocal(textValue: string): string | null | undefined {
  const t = textValue.trim();
  if (!t) return null;
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(t);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
export function toLocal(isoText: string | null | undefined): string {
  if (!isoText) return "";
  const d = new Date(isoText);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 活動日期顯示（不補 0）：單日「2026/11/20」，連續多天「2026/11/20～11/22」。 */
export function eventDays(start: string | null | undefined, end?: string | null): string {
  if (!start) return "";
  if (!end || end === start) return plainDate(start);
  return `${plainDate(start)}～${plainDate(end).split("/").slice(1).join("/")}`;
}

/** 單位名稱不顯示教育中心的數字代碼：「飛登 013」→「飛登」。 */

let customCenterNames: Record<string, string> = {};
export const centerKeyOf = (l: string) => l.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
/** 載入教育中心的自訂名稱（由 state/center-names.tsx 的 CenterNamesProvider 設定）。 */
export const setCenterNames = (m: Record<string, string>) => {
  customCenterNames = m;
};

/**
 * 全站唯一的「教育中心名稱」來源：有自訂名稱（編輯中心頁設定）就用自訂；沒有就用預設格式「去掉數字代碼＋中心」
 * （「南京 062」→「南京中心」、「美國洛杉磯」→「美國洛杉磯中心」、「台北中心」→「台北中心」，與分享預覽標題的名稱部分一致，後端規則在 apps/launch/src/og.ts；業主 2026-11-15 指定預設改為 XX中心）。
 * 所有顯示中心名稱的地方一律用它。
 */
export function centerTitle(label: string): string {
  const custom = customCenterNames[centerKeyOf(label)];
  if (custom) return custom;
  // 業主 2026-11-17：取消「自動在後面加中心二個字」，中央的名稱怎麼寫就怎麼顯示（只拿掉尾巴的數字代碼）。
  return label.replace(/\s*\d+\s*$/, "").trim() || label;
}

/** 中心簡稱（公告橫條用，業主 2026-11-21）：只留地名或中心名稱——「新竹中心」→「新竹」、「嘉義生活美學館」維持原樣。 */
export function centerShort(label: string): string {
  const t = centerTitle(label);
  const s = t.replace(/(教育)?中心$/, "").trim();
  return s.length >= 2 ? s : t;
}

/** 章節長度：「12分鐘」（超過 60 分鐘也一樣用分鐘，不顯示「小時」、不加「約」；沒有長度回空字串。業主 2026-11-16）。 */
export const minutesText = (m: number | null | undefined): string => (m && m > 0 ? `${m}分鐘` : "");

/** 章節的分享者顯示：「李講師﹒白金﹒經理」（姓名、獎銜、職稱用「﹒」連接，不加「分享者：」標題；沒填的略過；三者都沒填回空字串。業主 2026-11-16 全站統一）。 */
export function sharerLine(l: { sharer: string; sharerRankName: string; sharerTitle: string }): string {
  return [l.sharer, l.sharerRankName, l.sharerTitle].map((x) => x.trim()).filter(Boolean).join("﹒");
}


/**
 * 只有主辦單位的顯示（首頁區塊、課程資訊卡的「XX主辦」，不含指導單位）：
 * 一個主辦＝「美國洛杉磯中心主辦」；兩個以上＝去掉各中心後面的「中心」、用「/」連接（業主 2026-11-16）：「台中/彰化/員林主辦」。
 */
export function hostLine(c: { hostUnit: string }): string {
  const hosts = c.hostUnit.split(/[、,，;；\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => (x === "寰宇總部" ? x : centerTitle(x)));
  if (!hosts.length) return "";
  return hosts.length === 1 ? `${hosts[0]}主辦` : `${hosts.map((h) => h.replace(/中心$/, "")).join("/")}主辦`;
}

/** 課程卡與首頁的地點顯示文字：線上課程不顯示（「線上課程」只在報名明細的繳費確認才出現）；勾「無」或沒填也不顯示。 */
export function placeText(c: { isOnline?: boolean; locationNone?: boolean; location?: string | null }): string | null {
  if (c.isOnline) return null;
  if (c.locationNone || !c.location) return null;
  return c.location;
}
