/**
 * 「加入我的清單」（業主 2026-11-21）：會員自己建立的清單；課程卡、單一教材、系列卡、中心卡都能加入，同一個內容可加進多份清單。
 * 分享網址＝/會員編號/自訂名稱；點擊次數與人數用瀏覽器自己產生的匿名代碼計算（不記身分）。
 * 清單數量上限＝基本數量＋完成指定學習成就解鎖的數量（設定頁「清單解鎖設定」）。這裡只放資料庫與規則，路由在 api.ts。
 */
import type { D1Database } from "./d1.ts";

export class ListError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status: number, code: string, message: string): never => {
  throw new ListError(status, code, message);
};

export const LIST_ITEM_KINDS = ["course", "lesson", "series", "center"] as const;
export type ListItemKind = (typeof LIST_ITEM_KINDS)[number];
export const LIST_ITEM_MAX = 100;
const NAME_MAX = 30;

const rid = (n: number) => {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => a[b % a.length]).join("");
};

/** 自訂網址名稱：小寫英數與連字號、3～30 字。前面已有會員編號，不必避開網站保留字或短網址（業主 2026-11-21）。 */
export function checkSlug(raw: unknown): string {
  const s = typeof raw === "string" ? raw.normalize("NFKC").trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(s)) return fail(400, "invalid_slug", "網址名稱要 3 到 30 個字，只能用英文、數字與連字號（-）");
  return s;
}
export function checkTitle(raw: unknown): string {
  const t = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!t || t.length > NAME_MAX) return fail(400, "invalid_title", `清單名稱要 1 到 ${NAME_MAX} 個字`);
  return t;
}

export type ListRow = { id: string; owner_sub: string; owner_name: string; owner_avatar?: string; number: string; title: string; slug: string; cover_item_id: string | null; clicks: number; position: number; cover_mode?: string; cover_key?: string | null; cover_bg_id?: string | null; cover_ver?: number };
export type UnlockRule = { achievementId: string; extra: number };
export type QuotaInfo = { base: number; total: number; used: number; unlocks: UnlockOut[] };
export type UnlockOut = { achievementId: string; name: string; extra: number; earned: boolean; description: string; type: string; threshold: number; feature: string | null };

export async function quotaOf(db: D1Database, sub: string, base: number, rules: UnlockRule[]): Promise<QuotaInfo> {
  const [earned, used, names] = await Promise.all([
    db.prepare("SELECT achievement_id AS id FROM member_achievements WHERE member_sub = ?").bind(sub).all<{ id: string }>(),
    db.prepare("SELECT COUNT(*) AS n FROM my_lists WHERE owner_sub = ?").bind(sub).first<{ n: number }>(),
    rules.length ? db.prepare(`SELECT id, name, description, condition_type AS type, threshold, feature FROM achievements WHERE id IN (${rules.map(() => "?").join(",")})`).bind(...rules.map((r) => r.achievementId)).all<{ id: string; name: string; description: string; type: string; threshold: number; feature: string | null }>() : Promise.resolve({ results: [] as { id: string; name: string; description: string; type: string; threshold: number; feature: string | null }[] }),
  ]);
  const have = new Set(earned.results.map((r) => r.id));
  const nameOf = new Map(names.results.map((r) => [r.id, r]));
  const unlocks = rules.filter((r) => nameOf.has(r.achievementId)).map((r) => ({ achievementId: r.achievementId, name: nameOf.get(r.achievementId)!.name, description: nameOf.get(r.achievementId)!.description, type: nameOf.get(r.achievementId)!.type, threshold: nameOf.get(r.achievementId)!.threshold, feature: nameOf.get(r.achievementId)!.feature, extra: r.extra, earned: have.has(r.achievementId) }));
  return { base, total: base + unlocks.filter((u) => u.earned).reduce((a, u) => a + u.extra, 0), used: used?.n ?? 0, unlocks };
}

export type OwnList = { id: string; title: string; slug: string; clicks: number; people: number; count: number; url: string; coverItemId: string | null; coverUrl: string | null; coverMode: CoverMode; coverBgUrl: string | null; has?: boolean };
const urlOf = (l: { number: string; slug: string }) => `/${l.number}/${l.slug}`;
const pub = (key: string | null, v: number | null) => (key ? `/api/v2/media/pub?k=${encodeURIComponent(key)}&v=${v ?? 0}` : null);

/** 我的清單（可帶「這個內容有沒有在裡面」）。封面＝自選的項目，沒選就用第一個有封面的項目。 */
export async function ownLists(db: D1Database, sub: string, item?: { kind: ListItemKind; ref: string }): Promise<OwnList[]> {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.title, l.slug, l.number, l.clicks, l.cover_item_id AS coverItemId, l.cover_mode AS coverMode, l.cover_key AS coverKey, l.cover_bg_id AS coverBgId, l.cover_ver AS coverVer,
        (SELECT COUNT(*) FROM my_list_items i WHERE i.list_id = l.id) AS count,
        (SELECT COUNT(*) FROM my_list_visitors v WHERE v.list_id = l.id) AS people
        ${item ? ", EXISTS(SELECT 1 FROM my_list_items i WHERE i.list_id = l.id AND i.kind = ? AND i.ref = ?) AS has" : ", 0 AS has"}
       FROM my_lists l WHERE l.owner_sub = ? ORDER BY l.position, l.created_at`,
    )
    .bind(...(item ? [item.kind, item.ref] : []), sub)
    .all<{ id: string; title: string; slug: string; number: string; clicks: number; coverItemId: string | null; coverMode: string; coverKey: string | null; coverBgId: string | null; coverVer: number; count: number; people: number; has: number }>();
  const bgs = await coverBgMap(db);
  const covers = await Promise.all(results.map((r) => (r.coverMode === "item" && r.count ? listCover(db, r.id, r.coverItemId) : Promise.resolve(null))));
  return results.map((r, i) => ({ id: r.id, title: r.title, slug: r.slug, clicks: r.clicks, people: r.people, count: r.count, url: urlOf(r), coverItemId: r.coverItemId, ...coverOut({ cover_mode: r.coverMode, cover_key: r.coverKey, cover_bg_id: r.coverBgId, cover_ver: r.coverVer }, covers[i]!, bgs), ...(item ? { has: !!r.has } : {}) }));
}

export type CoverMode = "item" | "upload" | "text";
/** 管理員上傳的清單專用封面底圖（全部，數量不多）：id → 圖片網址。 */
async function coverBgMap(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db.prepare("SELECT id, image_key, art_version FROM list_cover_bgs").all<{ id: string; image_key: string; art_version: number }>();
  return new Map(results.map((r) => [r.id, pub(r.image_key, r.art_version)!]));
}
/** 清單封面的輸出：內容封面（item）＝項目圖；上傳（upload）＝自己上傳的圖；文字封面（text）＝沒有圖，畫面用清單名稱＋底圖（coverBgUrl，空＝純色）排出來。 */
function coverOut(l: { cover_mode?: string; cover_key?: string | null; cover_bg_id?: string | null; cover_ver?: number }, itemCover: string | null, bgs: Map<string, string>): { coverMode: CoverMode; coverUrl: string | null; coverBgUrl: string | null } {
  const mode: CoverMode = l.cover_mode === "upload" && l.cover_key ? "upload" : l.cover_mode === "text" ? "text" : "item";
  return { coverMode: mode, coverUrl: mode === "upload" ? pub(l.cover_key ?? null, l.cover_ver ?? 0) : mode === "item" ? itemCover : null, coverBgUrl: mode === "text" && l.cover_bg_id ? (bgs.get(l.cover_bg_id) ?? null) : null };
}

/** 清單封面：自選項目的封面；沒選（或那項已沒有封面）就用最上面第一個有封面的項目。 */
async function listCover(db: D1Database, listId: string, pick: string | null): Promise<string | null> {
  const items = await resolveItems(db, listId);
  const first = (pick ? items.find((x) => x.id === pick && x.coverUrl) : undefined) ?? items.find((x) => x.coverUrl && !x.missing);
  return first?.coverUrl ?? null;
}

const rand6 = () => rid(6);
export async function createList(db: D1Database, s: { sub: string; name: string; avatar?: string | null }, number: string, title: string, q: QuotaInfo): Promise<string> {
  if (q.used >= q.total) return fail(403, "list_quota", "清單數量已用完，完成指定的學習成就可以解鎖更多");
  const id = `l${rid(8)}`;
  await db
    .prepare("INSERT INTO my_lists (id, owner_sub, owner_name, owner_avatar, number, title, slug, cover_mode, position) VALUES (?, ?, ?, ?, ?, ?, ?, 'text', (SELECT COALESCE(MAX(position), 0) + 1 FROM my_lists WHERE owner_sub = ?))")
    .bind(id, s.sub, s.name, s.avatar ?? "", number, title, rand6(), s.sub)
    .run();
  return id;
}

export async function ownedList(db: D1Database, sub: string, id: string): Promise<ListRow> {
  const l = await db.prepare("SELECT id, owner_sub, owner_name, owner_avatar, number, title, slug, cover_item_id, clicks, position, cover_mode, cover_key, cover_bg_id, cover_ver FROM my_lists WHERE id = ? AND owner_sub = ?").bind(id, sub).first<ListRow>();
  return l ?? fail(404, "not_found", "找不到這份清單");
}

export type ItemRef = { kind: ListItemKind; ref: string; ref2: string };
export function readItem(b: { kind?: unknown; ref?: unknown; ref2?: unknown }): ItemRef {
  const kind = LIST_ITEM_KINDS.find((k) => k === b.kind);
  const ref = typeof b.ref === "string" ? b.ref.trim().slice(0, 80) : "";
  if (!kind || !ref) return fail(400, "invalid_item", "要加入的內容不正確");
  return { kind, ref, ref2: typeof b.ref2 === "string" ? b.ref2.trim().slice(0, 40) : "" };
}

/** 加入（新的放最上面）或移除。回傳清單目前的項目數。 */
export async function setItem(db: D1Database, listId: string, it: ItemRef, on: boolean): Promise<number> {
  if (on) {
    const n = (await db.prepare("SELECT COUNT(*) AS n FROM my_list_items WHERE list_id = ?").bind(listId).first<{ n: number }>())?.n ?? 0;
    const had = await db.prepare("SELECT 1 AS ok FROM my_list_items WHERE list_id = ? AND kind = ? AND ref = ?").bind(listId, it.kind, it.ref).first();
    if (!had && n >= LIST_ITEM_MAX) return fail(409, "list_full", `一份清單最多放 ${LIST_ITEM_MAX} 個內容`);
    if (!had) {
      await db.prepare("UPDATE my_list_items SET position = position + 1 WHERE list_id = ?").bind(listId).run();
      await db.prepare("INSERT INTO my_list_items (id, list_id, kind, ref, ref2, position) VALUES (?, ?, ?, ?, ?, 0)").bind(`i${rid(10)}`, listId, it.kind, it.ref, it.ref2).run();
    }
  } else await db.prepare("DELETE FROM my_list_items WHERE list_id = ? AND kind = ? AND ref = ?").bind(listId, it.kind, it.ref).run();
  return (await db.prepare("SELECT COUNT(*) AS n FROM my_list_items WHERE list_id = ?").bind(listId).first<{ n: number }>())?.n ?? 0;
}

export type ListItemOut = { id: string; kind: ListItemKind; ref: string; ref2: string; note: string; title: string; subtitle: string; coverUrl: string | null; missing: boolean; /** 這個「教材」其實是區塊（點下去進課程頁並展開該區塊）。 */ block?: boolean };

/** 把項目補上名稱與封面（內容被刪除或下架時顯示「已下架」，不會讓清單壞掉，也不會自動消失）。 */
export async function resolveItems(db: D1Database, listId: string): Promise<ListItemOut[]> {
  const { results } = await db.prepare("SELECT id, kind, ref, ref2, note FROM my_list_items WHERE list_id = ? ORDER BY position, created_at").bind(listId).all<{ id: string; kind: ListItemKind; ref: string; ref2: string; note: string }>();
  const courseIds = [...new Set(results.flatMap((r) => (r.kind === "course" ? [r.ref] : r.kind === "lesson" && r.ref2 ? [r.ref2] : [])))];
  const lessonIds = results.filter((r) => r.kind === "lesson").map((r) => r.ref);
  const mk = (n: number) => Array(n).fill("?").join(",");
  type C = { id: string; title: string; status: string; cover_key: string | null; edm_key: string | null; art_version: number | null };
  type L = { id: string; title: string; course_id: string; kind: string; cover_key: string | null; art_version: number | null };
  const [courses, lessons] = await Promise.all([
    courseIds.length ? db.prepare(`SELECT id, title, status, cover_key, edm_key, art_version FROM courses WHERE id IN (${mk(courseIds.length)})`).bind(...courseIds).all<C>() : Promise.resolve({ results: [] as C[] }),
    lessonIds.length ? db.prepare(`SELECT id, title, course_id, kind, cover_key, art_version FROM lessons WHERE id IN (${mk(lessonIds.length)})`).bind(...lessonIds).all<L>() : Promise.resolve({ results: [] as L[] }),
  ]);
  const cMap = new Map(courses.results.map((c) => [c.id, c]));
  const lMap = new Map(lessons.results.map((l) => [l.id, l]));
  const live = (c?: { status: string }) => !!c && c.status === "published";
  return results.map((r) => {
    if (r.kind === "course") {
      const c = cMap.get(r.ref);
      return { ...r, title: c?.title ?? "已下架的內容", subtitle: "", coverUrl: pub(c?.cover_key ?? c?.edm_key ?? null, c?.art_version ?? 0), missing: !live(c) };
    }
    if (r.kind === "lesson") {
      const l = lMap.get(r.ref);
      const c = cMap.get(l?.course_id ?? r.ref2);
      return { ...r, ref2: l?.course_id ?? r.ref2, ...(l?.kind === "section" ? { block: true } : {}), title: l?.title ?? "已下架的內容", subtitle: c?.title ?? "", coverUrl: pub(l?.cover_key ?? c?.cover_key ?? c?.edm_key ?? null, l?.art_version ?? c?.art_version ?? 0), missing: !l || !live(c) };
    }
    return { ...r, title: r.ref, subtitle: "", coverUrl: null, missing: false };
  });
}

/** 清單主人的內頁：項目＋點擊統計。 */
export async function ownDetail(db: D1Database, l: ListRow) {
  const [items, stats, bgs] = await Promise.all([resolveItems(db, l.id), listStats(db, l.id), coverBgMap(db)]);
  const pick = l.cover_item_id;
  const itemCover = ((pick ? items.find((x) => x.id === pick && x.coverUrl) : undefined) ?? items.find((x) => x.coverUrl && !x.missing))?.coverUrl ?? null;
  return { id: l.id, title: l.title, slug: l.slug, url: urlOf(l), coverItemId: l.cover_item_id, ...coverOut(l, itemCover, bgs), coverBgId: l.cover_bg_id ?? null, hasUpload: !!l.cover_key, uploadUrl: pub(l.cover_key ?? null, l.cover_ver ?? 0), itemCoverUrl: itemCover, coverBgChoiceUrl: l.cover_bg_id ? (bgs.get(l.cover_bg_id) ?? null) : null, clicks: l.clicks, items, stats };
}

/** 點擊來源分類：先看網址參數，再看上一頁網站。 */
export function sourceOf(hint: string, referrer: string): string {
  const x = `${hint} ${referrer}`.toLowerCase();
  if (/line\.|\bline\b|liff/.test(x)) return "line";
  if (/facebook|fb\.|fbav|messenger/.test(x)) return "facebook";
  if (/instagram/.test(x)) return "instagram";
  if (/wechat|weixin|qq\.com/.test(x)) return "wechat";
  if (/google\.|t\.co|twitter|x\.com|youtube/.test(x)) return "other";
  return referrer.trim() ? "other" : "direct";
}
const twDay = (now = Date.now()) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10);

export type ListStats = { clicks: number; people: number; bySource: Record<string, number>; days: { day: string; n: number }[] };
export async function listStats(db: D1Database, listId: string): Promise<ListStats> {
  const [tot, src, days, ppl] = await Promise.all([
    db.prepare("SELECT clicks FROM my_lists WHERE id = ?").bind(listId).first<{ clicks: number }>(),
    db.prepare("SELECT source, SUM(n) AS n FROM my_list_hits WHERE list_id = ? GROUP BY source").bind(listId).all<{ source: string; n: number }>(),
    db.prepare("SELECT day, SUM(n) AS n FROM my_list_hits WHERE list_id = ? AND day >= ? GROUP BY day ORDER BY day DESC").bind(listId, twDay(Date.now() - 13 * 86_400_000)).all<{ day: string; n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM my_list_visitors WHERE list_id = ?").bind(listId).first<{ n: number }>(),
  ]);
  return { clicks: tot?.clicks ?? 0, people: ppl?.n ?? 0, bySource: Object.fromEntries(src.results.map((r) => [r.source, r.n])), days: days.results };
}

export type PublicList = { title: string; ownerSub: string; ownerName: string; ownerAvatar: string | null; number: string; slug: string; count: number; clicks: number; items: ListItemOut[] };
const findPublic = (db: D1Database, number: string, slug: string) =>
  db.prepare("SELECT id, owner_sub, owner_name, owner_avatar, number, title, slug, cover_item_id, clicks, position FROM my_lists WHERE number = ? AND slug = ?").bind(number.toLowerCase(), slug.toLowerCase()).first<ListRow>();

/** 公開檢視（所有清單都公開）：點擊＝每次進入 +1；人數以匿名代碼不重複計算；清單主人自己看不算。 */
export async function viewPublic(db: D1Database, number: string, slug: string, vid: string, viewerSub: string | null, hint: string, referrer: string): Promise<PublicList> {
  const l = await findPublic(db, number, slug);
  if (!l) return fail(404, "not_found", "找不到這份清單");
  let clicks = l.clicks;
  if (viewerSub !== l.owner_sub) {
    clicks += 1;
    const src = sourceOf(hint.slice(0, 30), referrer.slice(0, 200));
    const stmts = [
      db.prepare("UPDATE my_lists SET clicks = clicks + 1 WHERE id = ?").bind(l.id),
      db.prepare("INSERT INTO my_list_hits (list_id, day, source, n) VALUES (?, ?, ?, 1) ON CONFLICT(list_id, day, source) DO UPDATE SET n = n + 1").bind(l.id, twDay(), src),
    ];
    if (/^[\w-]{8,40}$/.test(vid)) stmts.push(db.prepare("INSERT OR IGNORE INTO my_list_visitors (list_id, vid) VALUES (?, ?)").bind(l.id, vid));
    await db.batch(stmts);
  }
  const items = await resolveItems(db, l.id);
  return { title: l.title, ownerSub: l.owner_sub, ownerName: l.owner_name, ownerAvatar: l.owner_avatar || null, number: l.number, slug: l.slug, count: items.length, clicks, items };
}

/** 把別人的清單複製成自己的新清單（名稱沿用、項目照順序，不含備註）；額度不夠就回提示。 */
export async function copyList(db: D1Database, s: { sub: string; name: string }, myNumber: string, number: string, slug: string, q: QuotaInfo): Promise<string> {
  const src = await findPublic(db, number, slug);
  if (!src) return fail(404, "not_found", "找不到這份清單");
  if (src.owner_sub === s.sub) return fail(400, "own_list", "這是你自己的清單");
  const next = q.unlocks.find((u) => !u.earned);
  if (q.used >= q.total) return fail(403, "list_quota", next ? `清單數量已用完，完成「${next.name}」成就可以多解鎖 ${next.extra} 份` : "清單數量已用完");
  const id = await createList(db, s, myNumber, src.title.slice(0, NAME_MAX), q);
  await db.prepare("INSERT INTO my_list_items (id, list_id, kind, ref, ref2, position) SELECT 'i' || lower(hex(randomblob(5))), ?, kind, ref, ref2, position FROM my_list_items WHERE list_id = ?").bind(id, src.id).run();
  return id;
}

export async function setNote(db: D1Database, listId: string, itemId: string, note: unknown): Promise<void> {
  const t = typeof note === "string" ? note.trim().slice(0, 200) : "";
  const r = await db.prepare("UPDATE my_list_items SET note = ? WHERE id = ? AND list_id = ?").bind(t, itemId, listId).run();
  if (!r.meta?.changes) fail(404, "not_found", "找不到這個項目");
}

/** 自訂網址名稱（同一個會員編號底下不能重複）。 */
export async function setSlug(db: D1Database, l: ListRow, raw: unknown): Promise<void> {
  const slug = checkSlug(raw);
  if (slug === l.slug) return;
  const taken = await db.prepare("SELECT 1 AS ok FROM my_lists WHERE number = ? AND slug = ? AND id <> ?").bind(l.number, slug, l.id).first();
  if (taken) fail(409, "slug_taken", "這個網址名稱你已經用過了，請換一個");
  await db.prepare("UPDATE my_lists SET slug = ? WHERE id = ?").bind(slug, l.id).run();
}

/** 清單主人的名稱與頭像（會員中心的公開資料，不是 Amway 資料）：主人每次開清單相關頁面時順手更新，公開頁才有最新的名片。 */
export async function refreshOwner(db: D1Database, sub: string, name: string, avatar: string | null): Promise<void> {
  await db.prepare("UPDATE my_lists SET owner_name = ?, owner_avatar = ? WHERE owner_sub = ? AND (owner_name <> ? OR owner_avatar <> ?)").bind(name, avatar ?? "", sub, name, avatar ?? "").run();
}
