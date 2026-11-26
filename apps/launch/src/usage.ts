/**
 * 使用統計（業主 2026-11-22）：匿名彙總「裝置、系統、時段、首頁卡片點閱」，管理員可交叉統計。
 * 不存會員編號與 IP；只存彙總次數（`usage_stats`，migration 0113、0114）。
 * 業主本人的操作（管理員帳號、管理員用過的裝置、管理員用過的網路）記成 admin=1，統計預設不含，勾「包含管理員操作」才算（業主 2026-11-23）。
 */
import type { D1Database } from "./d1.ts";

export const USAGE_KINDS = ["visit", "card_course", "card_series", "card_center", "album_open", "album_folder", "album_photo", "album_search", "album_sort", "album_info", "album_share", "album_download", "album_move"] as const;
const DEVICES = ["mobile", "tablet", "desktop"] as const;
const MODES = ["elder", "super"] as const;
const OSES = ["ios", "android", "other"] as const;
export const USAGE_DIMS = ["device", "os", "slot", "hour", "day", "kind", "item", "mode"] as const;
export type UsageDim = (typeof USAGE_DIMS)[number];

const tw = (now = Date.now()) => new Date(now + 8 * 3600_000);

const OWNER_NET_DAYS = 30;
/** 網路位置 → 比對碼（IPv6 只看前 64 位元；不存原始 IP）。 */
export async function netHash(ip: string): Promise<string> {
  const norm = ip.includes(":") ? ip.split(":").slice(0, 4).join(":") : ip;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`learn-usage-net|${norm}`));
  return [...new Uint8Array(buf).slice(0, 12)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
/** 管理員用過的網路：記下（或更新時間）。 */
export async function markOwnerNet(db: D1Database, ip: string): Promise<void> {
  if (!ip) return;
  await db.prepare("INSERT INTO usage_owner_nets (hash, seen_at) VALUES (?, ?) ON CONFLICT(hash) DO UPDATE SET seen_at = excluded.seen_at").bind(await netHash(ip), new Date().toISOString()).run();
}
export async function isOwnerNet(db: D1Database, ip: string): Promise<boolean> {
  if (!ip) return false;
  const since = new Date(Date.now() - OWNER_NET_DAYS * 86_400_000).toISOString();
  return !!(await db.prepare("SELECT 1 AS x FROM usage_owner_nets WHERE hash = ? AND seen_at >= ?").bind(await netHash(ip), since).first());
}

/** 記一次（訪客也可以）；欄位不合格就忽略，不報錯、不影響使用。admin＝這次是業主本人的操作。 */
export async function recordUsage(db: D1Database, b: { kind?: unknown; device?: unknown; os?: unknown; target?: unknown; mode?: unknown }, admin = false): Promise<void> {
  if (!USAGE_KINDS.includes(b.kind as never) || !DEVICES.includes(b.device as never) || !OSES.includes(b.os as never)) return;
  const kind = b.kind as string;
  const target = kind === "visit" ? "" : typeof b.target === "string" ? b.target.trim().slice(0, 80) : "";
  if (kind !== "visit" && !target) return;
  const t = tw();
  await db
    .prepare("INSERT INTO usage_stats (day, hour, device, os, kind, target, admin, mode, n) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT(day, hour, device, os, kind, target, admin, mode) DO UPDATE SET n = n + 1")
    .bind(t.toISOString().slice(0, 10), t.getUTCHours(), b.device, b.os, kind, target, admin ? 1 : 0, MODES.includes(b.mode as never) ? (b.mode as string) : "")
    .run();
}

const MODE_LABEL: Record<string, string> = { elder: "至尊模式", super: "超派模式", "": "未記錄（舊資料）" };
const SLOTS = ["凌晨 0–5 點", "早上 6–11 點", "下午 12–17 點", "晚上 18–23 點"];
const DEVICE_LABEL: Record<string, string> = { mobile: "手機", desktop: "電腦", tablet: "平板" };
const OS_LABEL: Record<string, string> = { ios: "iOS", android: "Android", other: "其他（電腦等）" };
const KIND_LABEL: Record<string, string> = { visit: "開啟網站／App", card_course: "課程卡點閱", card_series: "系列卡點閱", card_center: "中心卡點閱", album_open: "打開相簿", album_folder: "打開相簿資料夾", album_photo: "看相簿照片", album_search: "相簿搜尋", album_sort: "相簿排序", album_info: "看圖片資訊", album_share: "分享相簿照片", album_download: "下載相簿照片", album_move: "移到子資料夾" };
const SLOT_SQL = "CASE WHEN hour < 6 THEN 0 WHEN hour < 12 THEN 1 WHEN hour < 18 THEN 2 ELSE 3 END";
const DIM_SQL: Record<UsageDim, string> = { device: "device", os: "os", slot: SLOT_SQL, hour: "hour", day: "day", kind: "kind", item: "kind || '|' || target", mode: "mode" };

export type UsageQuery = { kinds: string[]; days: number; device: string; os: string; slot: string; mode: string; rows: UsageDim; cols: UsageDim | null; /** 包含管理員（業主本人）的操作；預設不含。 */ admin: boolean };
export type UsageTable = { since: string; kinds: string[]; rows: { label: string; cells: number[]; total: number }[]; cols: string[]; total: number; truncated: boolean };

export function parseUsageQuery(u: URL): UsageQuery {
  const kinds = (u.searchParams.get("kinds") ?? "").split(",").filter((k) => USAGE_KINDS.includes(k as never));
  const dim = (v: string | null): UsageDim | null => (USAGE_DIMS.includes(v as never) ? (v as UsageDim) : null);
  const rows = dim(u.searchParams.get("rows")) ?? "device";
  const cols = dim(u.searchParams.get("cols"));
  const days = Math.min(365, Math.max(1, Number(u.searchParams.get("days")) || 30));
  const pick = (k: string, ok: readonly string[]) => (ok.includes(u.searchParams.get(k) ?? "") ? (u.searchParams.get(k) as string) : "");
  return { kinds: kinds.length ? kinds : ["visit"], days, device: pick("device", DEVICES), os: pick("os", OSES), slot: pick("slot", ["0", "1", "2", "3"]), mode: pick("mode", MODES), rows, cols: cols && cols !== rows ? cols : null, admin: u.searchParams.get("admin") === "1" };
}

export async function usageTable(db: D1Database, q: UsageQuery): Promise<UsageTable> {
  const since = tw(Date.now() - (q.days - 1) * 86_400_000).toISOString().slice(0, 10);
  const where = [`day >= ?`, `kind IN (${q.kinds.map(() => "?").join(",")})`];
  const args: (string | number)[] = [since, ...q.kinds];
  if (!q.admin) where.push("admin = 0");
  if (q.device) (where.push("device = ?"), args.push(q.device));
  if (q.os) (where.push("os = ?"), args.push(q.os));
  if (q.mode) (where.push("mode = ?"), args.push(q.mode));
  if (q.slot) (where.push(`${SLOT_SQL} = ?`), args.push(Number(q.slot)));
  const colSql = q.cols ? DIM_SQL[q.cols] : "''";
  const { results } = await db
    .prepare(`SELECT ${DIM_SQL[q.rows]} AS r, ${colSql} AS c, SUM(n) AS n FROM usage_stats WHERE ${where.join(" AND ")} GROUP BY r, c`)
    .bind(...args)
    .all<{ r: string | number; c: string | number; n: number }>();
  // 課程卡的名稱：用課程編號換成課程名稱。
  const ids = new Set<string>();
  if (q.rows === "item" || q.cols === "item") for (const x of results) for (const v of [x.r, x.c]) if (typeof v === "string" && v.startsWith("card_course|")) ids.add(v.slice(12));
  const titles = new Map<string, string>();
  for (const id of ids) {
    const row = await db.prepare("SELECT title FROM courses WHERE id = ?").bind(id).first<{ title: string }>();
    if (row) titles.set(id, row.title);
  }
  const label = (dim: UsageDim, v: string | number): string => {
    const s = String(v);
    if (dim === "device") return DEVICE_LABEL[s] ?? s;
    if (dim === "os") return OS_LABEL[s] ?? s;
    if (dim === "mode") return MODE_LABEL[s] ?? s;
    if (dim === "slot") return SLOTS[Number(s)] ?? s;
    if (dim === "hour") return `${String(s).padStart(2, "0")} 點`;
    if (dim === "kind") return KIND_LABEL[s] ?? s;
    if (dim === "item") {
      const [k, ...rest] = s.split("|");
      const t = rest.join("|");
      if (k!.startsWith("album_")) return `${KIND_LABEL[k!] ?? k}｜${t}`;
      return `${{ card_course: "課程", card_series: "系列", card_center: "中心" }[k!] ?? ""}｜${k === "card_course" ? titles.get(t) ?? t : t}`;
    }
    return s.replace(/^\d{4}-/, "").replace("-", "/");
  };
  const order = (dim: UsageDim, a: string | number, b: string | number, totals: Map<string, number>): number => {
    if (dim === "item") return (totals.get(String(b)) ?? 0) - (totals.get(String(a)) ?? 0);
    if (dim === "day") return String(b).localeCompare(String(a));
    if (dim === "device") return DEVICES.indexOf(String(a) as never) - DEVICES.indexOf(String(b) as never);
    if (dim === "mode") return ["elder", "super", ""].indexOf(String(a)) - ["elder", "super", ""].indexOf(String(b));
    if (dim === "os") return OSES.indexOf(String(a) as never) - OSES.indexOf(String(b) as never);
    if (dim === "kind") return USAGE_KINDS.indexOf(String(a) as never) - USAGE_KINDS.indexOf(String(b) as never);
    return Number(a) - Number(b);
  };
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  for (const x of results) {
    rowTotals.set(String(x.r), (rowTotals.get(String(x.r)) ?? 0) + x.n);
    colTotals.set(String(x.c), (colTotals.get(String(x.c)) ?? 0) + x.n);
  }
  const rowKeys = [...rowTotals.keys()].sort((a, b) => order(q.rows, a, b, rowTotals));
  const MAX_ROWS = 40;
  const colKeys = q.cols ? [...colTotals.keys()].sort((a, b) => order(q.cols!, a, b, colTotals)).slice(0, 12) : [""];
  const cell = new Map(results.map((x) => [`${x.r}\u0000${x.c}`, x.n]));
  const shown = rowKeys.slice(0, MAX_ROWS);
  return {
    since,
    kinds: q.kinds,
    cols: q.cols ? colKeys.map((k) => label(q.cols!, k)) : [],
    rows: shown.map((r) => ({ label: label(q.rows, r), cells: q.cols ? colKeys.map((c) => cell.get(`${r}\u0000${c}`) ?? 0) : [], total: rowTotals.get(r) ?? 0 })),
    total: [...rowTotals.values()].reduce((a, b) => a + b, 0),
    truncated: rowKeys.length > MAX_ROWS,
  };
}
