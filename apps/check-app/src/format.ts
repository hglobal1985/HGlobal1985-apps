/** 日期顯示（一律台灣時間）。 */
const tw = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000);
export function dueText(iso: string | null): string {
  if (!iso) return "沒有截止時間";
  const d = tw(iso);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
export function shortDue(iso: string): string {
  const d = tw(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
export function leftText(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso) - Date.now();
  if (ms < 0) return "已截止";
  const h = Math.floor(ms / 3600_000);
  if (h < 24) return `剩 ${h} 小時`;
  return `剩 ${Math.ceil(ms / 86400_000)} 天`;
}
export const dateOnly = (s: string | null) => (s ? s.replace(/-/g, "/") : "");
/** 「2027/01/09 23:59」或「2027-01-09 23:59」→ ISO（台灣時間）。 */
export function parseTw(s: string): string | null {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 23, m[5] ? +m[5] : 59) - 8 * 3600_000;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
export function isoToTwInput(iso: string | null): string {
  return iso ? dueText(iso) : "";
}
export const mb = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${(b / 1048576).toFixed(1)} MB`);
