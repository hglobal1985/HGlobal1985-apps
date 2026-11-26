/**
 * 食譜專區的資料庫與規則（杜杜龍 2026-11-26；路由在 api.ts）。
 * 一道食譜＝名稱＋分類＋多張照片＋一篇純文字。照片沿用相簿的 cover_media（owner_kind='course'、owner_key＝`rcp:`＋食譜編號），上傳、壓縮、排序、刪除、辨識都用同一套。
 * 文字裡「獨立一行」的 YouTube 網址，看食譜時變成站內影片卡片。
 */
import type { D1Database, Env } from "./d1.ts";
import type { RecipeCard, RecipeCategory } from "./contract.ts";
import { loadConfig } from "./ui-config.ts";

export const RECIPE_KEY = "rcp:";
export const TITLE_MAX = 60;
export const BODY_MAX = 20000;
export const CATEGORY_MAX = 10;
export const recipeKey = (id: string) => `${RECIPE_KEY}${id}`;
export const recipeIdOfKey = (key: string): string | null => (key.startsWith(RECIPE_KEY) ? key.slice(RECIPE_KEY.length) : null);
/** 目前與以前用過的短網址前綴（小寫）。 */
export async function recipePrefixes(db: D1Database): Promise<{ cur: string; all: string[] }> {
  const s = (await loadConfig(db)).share;
  return { cur: s.recipePrefix, all: [s.recipePrefix, ...s.recipeAliases].map((x) => x.toLowerCase()) };
}
export async function isRecipePrefix(db: D1Database, slug: string): Promise<boolean> {
  return (await recipePrefixes(db)).all.includes(slug.toLowerCase());
}
/** /icook/001 → 食譜編號（只認已發佈的；前綴不分大小寫，舊前綴也認得）。 */
export async function recipeByShortPath(db: D1Database, prefix: string, name: string): Promise<string | null> {
  if (!/^\d{3,9}$/.test(name) || !(await isRecipePrefix(db, prefix))) return null;
  return (await db.prepare("SELECT id FROM recipes WHERE number = ? AND status = 'published'").bind(Number(name)).first<{ id: string }>())?.id ?? null;
}
/** 第一次送出時領流水號（編輯中的草稿不佔號碼）。 */
export async function assignNumber(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE recipes SET number = (SELECT COALESCE(MAX(number), 0) + 1 FROM recipes) WHERE id = ? AND number IS NULL").bind(id).run();
}
export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

const YT_LINE = /^\s*(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\/\S+\s*$/i;
/** 這一行如果只有一個 YouTube 網址，回傳影片編號。 */
export function youtubeIdOfLine(line: string): string | null {
  if (!YT_LINE.test(line)) return null;
  const raw = line.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^(www|m)\./, "");
    if (host === "youtu.be") return /^[\w-]{6,20}$/.test(u.pathname.split("/")[1] ?? "") ? u.pathname.split("/")[1]! : null;
    const v = u.searchParams.get("v");
    if (v && /^[\w-]{6,20}$/.test(v)) return v;
    const m = /\/(?:shorts|embed|live)\/([\w-]{6,20})/.exec(u.pathname);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}
export const videoCount = (body: string) => body.split(/\r?\n/).filter((l) => youtubeIdOfLine(l)).length;

export function cleanTitle(raw: unknown): string {
  return (typeof raw === "string" ? raw : "").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
}
export function cleanBody(raw: unknown): string {
  return (typeof raw === "string" ? raw : "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim().slice(0, BODY_MAX);
}

type Row = { author_center_label: string; id: string; title: string; category_id: string; category_name: string | null; status: "draft" | "pending" | "published"; author_sub: string; author_name: string; body: string; thumb: string | null; photos: number };

/** 列表用：已發佈的全部＋待審核的（管理者看全部、投稿者看自己的）；q 同時找名稱與整篇文字。 */
export async function listRecipes(db: D1Database, o: { me: string | null; manager: boolean; q: string; pub: (key: string) => string }): Promise<{ categories: RecipeCategory[]; recipes: RecipeCard[] }> {
  const like = o.q ? `%${o.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : "";
  const [cats, rows] = await Promise.all([
    db.prepare("SELECT c.id, c.name, (SELECT COUNT(*) FROM recipes r WHERE r.category_id = c.id AND r.status = 'published') AS n FROM recipe_categories c ORDER BY c.position, c.created_at").all<{ id: string; name: string; n: number }>(),
    db
      .prepare(
        `SELECT r.id, r.title, r.category_id, c.name AS category_name, r.status, r.author_sub, r.author_name, r.author_center_label, r.body,
          (SELECT m.r2_key FROM cover_media m WHERE m.owner_kind = 'course' AND m.owner_key = 'rcp:' || r.id AND m.kind = 'image' ORDER BY m.position LIMIT 1) AS thumb,
          (SELECT COUNT(*) FROM cover_media m WHERE m.owner_kind = 'course' AND m.owner_key = 'rcp:' || r.id AND m.kind = 'image') AS photos
         FROM recipes r LEFT JOIN recipe_categories c ON c.id = r.category_id
         WHERE (r.status = 'published' OR (r.status = 'pending' AND (?1 = 1 OR r.author_sub = ?2)))
           AND (?3 = '' OR r.title LIKE ?3 ESCAPE '\\' OR r.body LIKE ?3 ESCAPE '\\')
         ORDER BY (r.status = 'pending') DESC, r.updated_at DESC LIMIT 400`,
      )
      .bind(o.manager ? 1 : 0, o.me ?? "", like)
      .all<Row>(),
  ]);
  return {
    categories: cats.results.map((c) => ({ id: c.id, name: c.name, count: c.n })),
    recipes: rows.results.map((r) => ({
      id: r.id,
      title: r.title,
      categoryId: r.category_id,
      categoryName: r.category_name ?? "",
      status: r.status === "pending" ? "pending" : "published",
      thumb: r.thumb ? o.pub(r.thumb) : null,
      photos: r.photos,
      videos: videoCount(r.body),
      authorName: r.author_name,
      authorCenter: r.author_center_label,
      canEdit: o.manager || (!!o.me && r.author_sub === o.me && r.status !== "published"),
    })),
  };
}

/** 刪除一道食譜與它的所有照片（連 R2 檔案）。 */
export async function deleteRecipe(db: D1Database, env: Env, id: string): Promise<void> {
  const photos = await db.prepare("SELECT r2_key, poster_key FROM cover_media WHERE owner_kind = 'course' AND owner_key = ?").bind(recipeKey(id)).all<{ r2_key: string; poster_key: string | null }>();
  await db.batch([db.prepare("DELETE FROM cover_media WHERE owner_kind = 'course' AND owner_key = ?").bind(recipeKey(id)), db.prepare("DELETE FROM recipes WHERE id = ?").bind(id)]);
  for (const p of photos.results) for (const k of [p.r2_key, p.poster_key]) if (k) await env.MEDIA?.delete(k).catch(() => undefined);
}

/** 超過兩天還沒按儲存的草稿（編輯到一半關掉）順手清掉，每次最多 5 筆。 */
export async function purgeStaleDrafts(db: D1Database, env: Env): Promise<void> {
  const { results } = await db.prepare("SELECT id FROM recipes WHERE status = 'draft' AND updated_at < datetime('now', '-2 days') LIMIT 5").all<{ id: string }>();
  for (const r of results) await deleteRecipe(db, env, r.id);
}
