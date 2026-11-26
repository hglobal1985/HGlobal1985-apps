import type { D1Database, D1PreparedStatement } from "./d1.ts";
import { centerKey } from "./central.ts";

/**
 * 中心改名自動對應（杜杜龍 2026-11-17：在會員中心把「新竹 122」改成「新竹中心 122」後，行動大學原本掛在舊名稱下的課程、
 * 封面、訂閱、小編、審核群組……全部找不到）。
 * 行動大學的資料是用「中心名稱的正規化（centerKey）」當鑰匙存的，中央一改名鑰匙就對不上。
 * 這裡在中央清單有變動時，自動把資料庫裡所有舊鑰匙換成新的：
 *   ① 名稱尾巴的中心代碼（例 122）相同就視為同一個中心；
 *   ② 沒有代碼的（例「美國洛杉磯」→「美國洛杉磯中心」）以去掉「中心」二字後相同視為同一個中心。
 * 完全對不上的舊鑰匙不動（不會亂猜）。回傳這次換掉幾個中心。
 */
const codeOf = (label: string): string | null => /\s(\d{2,4})\s*$/.exec(label.trim())?.[1] ?? null;
const stripCenter = (k: string) => k.replace(/教育中心|中心/g, "").replace(/\s+/g, " ").trim();

/** 有存中心鑰匙的欄位：[表, 欄位]（不含要另外處理的）。 */
const KEY_COLS: [string, string][] = [
  ["courses", "host_center_key"],
  ["center_art", "center_key"],
  ["center_info", "center_key"],
  ["center_names", "center_key"],
  ["center_subscriptions", "center_key"],
  ["center_broadcasts", "center_key"],
  ["center_broadcast_cfg", "center_key"],
  ["course_editors", "center_key"],
  ["review_group_members", "center_key"],
  ["review_groups", "owner_center_key"],
  ["orders", "center_key"],
  ["notifications", "recipient_center_key"],
  ["member_contacts", "president_center_key"],
  ["push_subscriptions", "center_key"],
  ["center_views", "center_key"],
  ["center_schedules", "center_key"],
  ["cover_media", "center_key"],
  ["center_cover_cfg", "center_key"],
];
/** 同一列還有「顯示名稱」欄位的表：換鑰匙時一起換成中央的新名稱。 */
const LABEL_COLS: Record<string, string> = {
  center_art: "center_label",
  center_info: "center_label",
  center_schedules: "center_label",
  center_names: "center_label",
  course_editors: "center_label",
  review_group_members: "center_label",
  review_groups: "owner_center_label",
  orders: "center_label",
};

export async function reconcileCenters(db: D1Database, labels: string[]): Promise<number> {
  const newByKey = new Map(labels.map((l) => [centerKey(l), l]));
  const newByCode = new Map(labels.flatMap((l) => (codeOf(l) ? [[codeOf(l)!, l] as [string, string]] : [])));
  const newByBase = new Map(labels.map((l) => [stripCenter(centerKey(l)), l]));
  const old = new Set<string>();
  for (const [t, c] of KEY_COLS) {
    const { results } = await db.prepare(`SELECT DISTINCT ${c} AS k FROM ${t} WHERE ${c} IS NOT NULL AND ${c} <> ''`).all<{ k: string }>();
    for (const r of results) old.add(r.k);
  }
  // 課程「主辦單位」文字裡出現的中心（多中心主辦時，後面的中心不一定有存在鑰匙欄位）也要對應。
  const hosts = await db.prepare("SELECT id, host_unit FROM courses WHERE host_unit <> ''").all<{ id: string; host_unit: string }>();
  for (const h of hosts.results) for (const p of h.host_unit.split(/[、,，;；\n]+/)) if (p.trim() && p.trim() !== "寰宇總部") old.add(centerKey(p));
  const map = new Map<string, string>(); // 舊鑰匙 → 中央新名稱
  for (const k of old) {
    if (newByKey.has(k) || k.startsWith("series:")) continue;
    const code = codeOf(k);
    const target = (code ? newByCode.get(code) : undefined) ?? newByBase.get(stripCenter(k));
    if (target && centerKey(target) !== k) map.set(k, target);
  }
  if (!map.size) return 0;

  const stmts: D1PreparedStatement[] = [];
  for (const [oldKey, label] of map) {
    const nk = centerKey(label);
    for (const [t, c] of KEY_COLS) {
      const lc = LABEL_COLS[t];
      stmts.push(db.prepare(`UPDATE OR IGNORE ${t} SET ${c} = ?${lc ? `, ${lc} = ?` : ""} WHERE ${c} = ?`).bind(...(lc ? [nk, label, oldKey] : [nk, oldKey])));
    }
    // 主鍵撞到新鑰匙而沒換成的重複列直接刪掉（新鑰匙那邊已經有同一筆）。
    for (const t of ["center_art", "center_info", "center_names", "center_subscriptions", "center_views", "center_broadcast_cfg", "course_editors", "review_group_members", "center_cover_cfg"]) {
      stmts.push(db.prepare(`DELETE FROM ${t} WHERE ${KEY_COLS.find((x) => x[0] === t)![1]} = ?`).bind(oldKey));
    }
    stmts.push(db.prepare("UPDATE OR IGNORE page_views SET key = ? WHERE kind = 'center' AND key = ?").bind(nk, oldKey));
    stmts.push(db.prepare("UPDATE OR IGNORE course_url_aliases SET scope = ? WHERE scope = ?").bind(nk, oldKey));
  }
  // 課程的「主辦單位」文字（多個中心用「、」連接）與中心短網址的對應名稱，逐一換成新名稱。
  for (const h of hosts.results) {
    const parts: string[] = h.host_unit.split(/([、,，;；\n]+)/);
    let changed = false;
    const next = parts.map((p) => {
      const t = map.get(centerKey(p));
      if (t) changed = true;
      return t ?? p;
    });
    if (changed) stmts.push(db.prepare("UPDATE courses SET host_unit = ? WHERE id = ?").bind(next.join(""), h.id));
  }
  const links = await db.prepare("SELECT slug, value FROM short_links WHERE kind = 'center'").all<{ slug: string; value: string }>();
  for (const l of links.results) {
    const t = map.get(centerKey(l.value));
    if (t) stmts.push(db.prepare("UPDATE OR IGNORE short_links SET value = ? WHERE slug = ?").bind(t, l.slug));
  }
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  return map.size;
}

/** 中央清單變動時才執行（用清單內容的簽名記在 central_snapshots，避免每次請求都掃資料庫）。 */
export async function ensureCentersReconciled(db: D1Database, labels: string[]): Promise<void> {
  if (!labels.length) return;
  const sig = JSON.stringify(labels);
  const row = await db.prepare("SELECT value FROM central_snapshots WHERE key = 'centers_reconciled'").first<{ value: string }>();
  if (row?.value === sig) return;
  try {
    await reconcileCenters(db, labels);
    await db.prepare("INSERT INTO central_snapshots (key, value) VALUES ('centers_reconciled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").bind(sig).run();
  } catch {
    /* 失敗下次再試，不影響使用 */
  }
}
