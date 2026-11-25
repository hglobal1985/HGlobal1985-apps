import type { HwGrading, HwResult, HwStatus } from "@/api/client";
import type { PillTone } from "@/ui/pill";

/** 作業的日期顯示（台灣時間）：12/05（五）23:59。 */
const WD = ["日", "一", "二", "三", "四", "五", "六"];
export function hwWhen(iso: string | null | undefined, time = true): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WD[d.getUTCDay()]}）${time ? ` ${hm}` : ""}`;
}
/** 還剩幾天（截止前）。 */
export function hwLeft(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return "已過截止時間";
  const h = Math.floor(ms / 3600_000);
  return h < 24 ? `還剩 ${Math.max(1, h)} 小時` : `還剩 ${Math.ceil(h / 24)} 天`;
}
/** DateSelect 的 YYYY-MM-DD ↔ 存檔的時間：截止＝當天 23:59、開放＝當天 00:00（台灣時間）。 */
export const dueIso = (d: string) => (d ? new Date(`${d}T23:59:00+08:00`).toISOString() : null);
export const openIso = (d: string) => (d ? new Date(`${d}T00:00:00+08:00`).toISOString() : null);
export const isoDay = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10) : "");

export const STATUS_TEXT: Record<HwStatus, { label: string; tone: PillTone }> = {
  none: { label: "待繳", tone: "warning" },
  draft: { label: "還沒送出", tone: "warning" },
  submitted: { label: "已繳交", tone: "accent" },
  graded: { label: "已批改", tone: "success" },
  returned: { label: "請重交", tone: "danger" },
};
/** 老師看的狀態文字（「待繳」改成「未繳」，「已繳交」改成「待批改」）。 */
export const TEACHER_STATUS: Record<HwStatus, { label: string; tone: PillTone }> = {
  none: { label: "未繳", tone: "neutral" },
  draft: { label: "未繳", tone: "neutral" },
  submitted: { label: "待批改", tone: "warning" },
  graded: { label: "已批改", tone: "success" },
  returned: { label: "已退回", tone: "danger" },
};
export const stars = (n: number) => `${"★".repeat(n)}${"☆".repeat(Math.max(0, 5 - n))}`;
/** 成績的短文字：92 分／★★★★☆／通過／請重交。 */
export function resultShort(g: HwGrading, r: HwResult | null, status: HwStatus): string | null {
  if (status === "returned") return "請重交";
  if (!r || status !== "graded") return null;
  if (g === "score") return `${r.score} 分`;
  if (g === "stars") return stars(r.stars ?? 0);
  return "通過";
}
export const GRADING_HINT: Record<HwGrading, string> = { score: "分數", stars: "5 顆星", pass: "通過／重交" };
