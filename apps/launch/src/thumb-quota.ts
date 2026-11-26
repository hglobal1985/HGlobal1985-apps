import type { D1Database } from "./d1.ts";

/**
 * 縮圖額度與優先順序（杜杜龍 2026-11-24）：封面（課程、系列、中心照片）> 中心 EDM > 其他相簿（成交百寶箱）。
 * 預留額度制：中心 EDM 最多用到每月額度的 edmPct%、其他相簿最多 albumPct%，剩下的留給更高優先的；達到上限就不縮（回原圖），封面永遠先縮。
 */
export type ThumbClass = "cover" | "edm" | "album";
export type ThumbQuota = { monthly: number; edmPct: number; albumPct: number };
export const THUMB_CLASSES: { cls: ThumbClass; label: string; priority: number }[] = [
  { cls: "cover", label: "封面（課程、系列、中心照片）", priority: 1 },
  { cls: "edm", label: "中心 EDM", priority: 2 },
  { cls: "album", label: "其他相簿（成交百寶箱）", priority: 3 },
];
export const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);

/** 這個檔案屬於哪一級、哪個細項。 */
export async function classify(db: D1Database, key: string): Promise<{ cls: ThumbClass; grp: string }> {
  const m = await db.prepare("SELECT owner_kind, scope, owner_key, center_key FROM cover_media WHERE r2_key = ? OR poster_key = ? LIMIT 1").bind(key, key).first<{ owner_kind: string; scope: string; owner_key: string; center_key: string | null }>();
  if (m) {
    if (m.owner_kind === "center") return m.scope === "edm" ? { cls: "edm", grp: m.center_key ?? "" } : { cls: "cover", grp: "center" };
    if (m.owner_kind === "course" && (await db.prepare("SELECT 1 AS ok FROM lessons WHERE id = ? AND kind = 'section'").bind(m.owner_key).first())) return { cls: "album", grp: m.owner_key };
    return { cls: "cover", grp: m.owner_kind };
  }
  return { cls: "cover", grp: "other" };
}

/** 這張縮圖要不要縮：已經算過的（同月、同檔、同寬）免費；新的先看有沒有超過這一級的上限，沒有就記一筆。 */
export async function reserveThumb(db: D1Database, q: ThumbQuota, key: string, w: number): Promise<boolean> {
  const month = monthOf();
  if (await db.prepare("SELECT 1 AS ok FROM thumb_usage WHERE month = ? AND key = ? AND w = ?").bind(month, key, w).first()) return true;
  const { cls, grp } = await classify(db, key);
  const total = (await db.prepare("SELECT COUNT(*) AS n FROM thumb_usage WHERE month = ?").bind(month).first<{ n: number }>())?.n ?? 0;
  const cap = cls === "edm" ? Math.floor((q.monthly * q.edmPct) / 100) : cls === "album" ? Math.floor((q.monthly * q.albumPct) / 100) : q.monthly;
  if (total >= cap) return false;
  await db.prepare("INSERT OR IGNORE INTO thumb_usage (month, key, w, cls, grp) VALUES (?, ?, ?, ?, ?)").bind(month, key, w, cls, grp).run();
  return true;
}

export type ThumbUsage = {
  month: string;
  monthly: number;
  used: number;
  remaining: number;
  quota: ThumbQuota;
  classes: { cls: ThumbClass; label: string; priority: number; used: number; cap: number; remaining: number }[];
  groups: { cls: ThumbClass; label: string; used: number }[];
};
export async function thumbUsage(db: D1Database, q: ThumbQuota): Promise<ThumbUsage> {
  const month = monthOf();
  const rows = (await db.prepare("SELECT cls, grp, COUNT(*) AS n FROM thumb_usage WHERE month = ? GROUP BY cls, grp").bind(month).all<{ cls: ThumbClass; grp: string; n: number }>()).results;
  const used = rows.reduce((s, r) => s + r.n, 0);
  const usedOf = (c: ThumbClass) => rows.filter((r) => r.cls === c).reduce((s, r) => s + r.n, 0);
  const capOf = (c: ThumbClass) => (c === "edm" ? Math.floor((q.monthly * q.edmPct) / 100) : c === "album" ? Math.floor((q.monthly * q.albumPct) / 100) : q.monthly);
  const blockIds = rows.filter((r) => r.cls === "album").map((r) => r.grp);
  const titles = new Map<string, string>();
  if (blockIds.length) {
    const { results } = await db.prepare(`SELECT l.id, l.title, c.title AS course FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id IN (${blockIds.map(() => "?").join(",")})`).bind(...blockIds).all<{ id: string; title: string; course: string }>();
    for (const r of results) titles.set(r.id, `${r.course} › ${r.title}`);
  }
  const kindName: Record<string, string> = { center: "中心照片", course: "課程封面", series: "系列封面", other: "其他封面（品牌 logo、區塊…）" };
  const groups = rows
    .map((r) => ({ cls: r.cls, label: r.cls === "album" ? titles.get(r.grp) ?? r.grp : r.cls === "edm" ? `${r.grp || "（未知中心）"} EDM` : kindName[r.grp] ?? r.grp, used: r.n }))
    .sort((a, b) => THUMB_CLASSES.findIndex((x) => x.cls === a.cls) - THUMB_CLASSES.findIndex((x) => x.cls === b.cls) || b.used - a.used);
  return {
    month,
    monthly: q.monthly,
    used,
    remaining: Math.max(0, q.monthly - used),
    quota: q,
    classes: THUMB_CLASSES.map((c) => ({ ...c, used: usedOf(c.cls), cap: capOf(c.cls), remaining: Math.max(0, capOf(c.cls) - used) })),
    groups,
  };
}
