import { centerKey } from "./central.ts";
import type { D1Database } from "./d1.ts";
import { DEFAULT_SHARE_SETTINGS, type ShareSettings } from "./contract.ts";
import { urlNameVariants } from "./romanize.ts";
import { HQ_SLUG, RESERVED_SLUGS } from "./short-links.ts";
import { loadConfig } from "./ui-config.ts";

const SITE = "寰宇行動大學";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * 分享預覽（LINE、Facebook…讀的是網頁原始碼，不會執行 JavaScript）：
 * 把 index.html 的標題與分享標籤換成指定內容。
 */
export function withShareMeta(html: string, m: { title: string; description: string; url: string; image: string }): string {
  const t = esc(m.title);
  const d = esc(m.description);
  const tags = [
    `<meta name="description" content="${d}"/>`,
    `<meta property="og:site_name" content="${SITE}"/>`,
    `<meta property="og:type" content="website"/>`,
    `<meta property="og:title" content="${t}"/>`,
    `<meta property="og:description" content="${d}"/>`,
    `<meta property="og:url" content="${esc(m.url)}"/>`,
    `<meta property="og:image" content="${esc(m.image)}"/>`,
    `<meta name="twitter:card" content="summary"/>`,
  ].join("");
  const stripped = html.replace(/<meta (?:name="(?:description|twitter:card)"|property="og:[a-z_:]+")[^>]*>/g, "");
  return stripped.replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`).replace("</head>", `${tags}</head>`);
}

/** 中心的分享標題名稱：去掉數字代碼，結尾補「中心」（已以「中心」或「教育中心」結尾的先去掉，避免重複；杜杜龍 2026-11-15 指定預設為 XX中心）。「南京 062」→「南京中心」、「美國洛杉磯」→「美國洛杉磯中心」、「台北中心」→「台北中心」。 */
export function centerShareName(label: string): string {
  // 杜杜龍 2026-11-17：取消「自動在後面加中心二個字」，中央的名稱怎麼寫就怎麼顯示（只拿掉尾巴的數字代碼）。
  return label.replace(/\s*\d+\s*$/, "").trim() || label;
}

/** 分享標題用的中心名稱：有自訂名稱就用自訂，沒有用預設格式。 */
export async function centerDisplayName(db: D1Database, label: string): Promise<string> {
  const r = await db.prepare("SELECT display_name AS n FROM center_names WHERE center_key = ?").bind(centerKey(label)).first<{ n: string }>().catch(() => null);
  return r?.n?.trim() || centerShareName(label);
}

/** 中心的分享內容（杜杜龍 2026-11-16）：名稱與地址。 */
export async function centerShareParts(db: D1Database, label: string): Promise<{ name: string; address: string }> {
  const name = await centerDisplayName(db, label);
  const a = await db.prepare("SELECT address AS a FROM center_info WHERE center_key = ?").bind(centerKey(label)).first<{ a: string }>().catch(() => null);
  return { name, address: a?.a?.trim() ?? "" };
}

type ShareMeta = { title: string; description: string; url: string; image: string };

/** 分享預設值（設定頁「分享預設值」，超級管理員編輯）。 */
const shareCfg = async (db: D1Database): Promise<ShareSettings> => (await loadConfig(db).catch(() => null))?.share ?? DEFAULT_SHARE_SETTINGS;
/** 預覽卡的第一行（杜杜龍 2026-11-26 一律格式）：「課程／系列／中心名稱 | 寰宇行動大學 🎓」。 */
export const SHARE_BADGE = "🎓";
export const titleOf = (S: ShareSettings, name: string) => `${name}${S.titleSeparator}${S.siteName}${S.siteName.includes(SHARE_BADGE) ? "" : ` ${SHARE_BADGE}`}`;
const randomQuote = async (db: D1Database) => (await db.prepare("SELECT body FROM quotes ORDER BY RANDOM() LIMIT 1").first<{ body: string }>().catch(() => null))?.body?.trim() || "";

/** 預覽卡片的備註（杜杜龍 2026-11-26 一律格式）：只放一句隨機學習金句（每次被讀取都重新抽，LINE 重新抓取時就會換一句）；金句關閉或沒有金句才用備用文字。不再放地址。 */
async function describe(db: D1Database, S: ShareSettings, _address = ""): Promise<string> {
  const quote = S.showQuote ? await randomQuote(db) : "";
  return quote || S.fallbackDescription || S.siteName;
}

/** 中心的預覽卡片（標題與備註）；label＝null 表示總部（沒有主辦中心）。單堂課程的分享也用它主辦中心的卡片。 */
async function centerCard(db: D1Database, S: ShareSettings, label: string | null): Promise<{ name: string; description: string }> {
  if (!label) return { name: S.hqName, description: await describe(db, S) };
  const p = await centerShareParts(db, label);
  return { name: p.name, description: await describe(db, S, p.address) };
}

const clip = (v: string | null | undefined, n = 60) => (v ?? "").trim().slice(0, n);
const pubImage = (origin: string, k: string | null | undefined, v: number | null | undefined) => (k ? `${origin}/api/v2/media/pub?k=${encodeURIComponent(k)}&v=${v ?? 0}` : `${origin}/icon-512.png`);

/** 縮寫 → {現在的縮寫, 種類, 值}；改名前的舊縮寫（別名）也認得，但回傳現在的縮寫，預覽網址永遠是最新的（杜杜龍 2026-11-26）。 */
async function slugRow(db: D1Database, slug: string, kind?: string): Promise<{ slug: string; kind: string; value: string } | null> {
  const cond = kind ? " AND kind = ?" : "";
  const bind = kind ? [slug, kind] : [slug];
  const now = await db.prepare(`SELECT slug, kind, value FROM short_links WHERE slug = ? COLLATE NOCASE${cond}`).bind(...bind).first<{ slug: string; kind: string; value: string }>();
  if (now) return now;
  const old = await db.prepare(`SELECT kind, value FROM short_link_aliases WHERE slug = ? COLLATE NOCASE${cond}`).bind(...bind).first<{ kind: string; value: string }>().catch(() => null);
  if (!old) return null;
  const cur = await db.prepare("SELECT slug FROM short_links WHERE kind = ? AND value = ?").bind(old.kind, old.value).first<{ slug: string }>();
  return cur ? { slug: cur.slug, kind: old.kind, value: old.value } : null;
}

/** 短網址的分享預覽：中心＝中心的預覽卡片；分類／系列＝標題 {名稱}＋站名、備註是隨機學習金句。找不到短網址回 null。 */
export async function shortLinkMeta(db: D1Database, slug: string, origin: string): Promise<ShareMeta | null> {
  const row = await slugRow(db, slug);
  if (!row) return null;
  const S = await shareCfg(db);
  // 預覽圖：系列有上傳 EDM 就用 EDM；中心優先用「裁切好的 16:9 封面」（杜杜龍指定的位置），沒有封面才用整張 EDM；都沒有用網站圖示。
  const art =
    row.kind === "series"
      ? await db.prepare("SELECT edm_key AS k, art_version AS v FROM series_art WHERE series = ?").bind(row.value).first<{ k: string; v: number }>().catch(() => null)
      : row.kind === "center"
        ? await db.prepare("SELECT COALESCE(cover_key, edm_key) AS k, art_version AS v FROM center_art WHERE center_label = ?").bind(row.value).first<{ k: string; v: number }>().catch(() => null)
        : null;
  const image = pubImage(origin, art?.k, art?.v);
  const url = `${origin}/${row.slug}`;
  if (row.kind === "center") {
    const card = await centerCard(db, S, row.value);
    return { title: titleOf(S, card.name), description: card.description, url, image };
  }
  return { title: titleOf(S, row.value), description: await describe(db, S), url, image };
}

/** 課程專屬網址（/中心縮寫或 hq/英譯姓名-編號）的分享預覽：標題與備註跟「主辦中心」的預覽卡片一致（總部主辦用總部名稱），圖用課程封面。找不到回 null。 */
export async function courseUrlMeta(db: D1Database, slug: string, name: string, origin: string): Promise<ShareMeta | null> {
  // 中心縮寫（照設定的大小寫顯示、輸入不分大小寫）或總部的 hq。
  const hq = slug.toLowerCase() === HQ_SLUG;
  // 素材的第二層網址：/系列縮寫/素材名稱（改名前的舊名稱也認得）。
  const serRow = hq ? null : await slugRow(db, slug, "series");
  if (serRow) {
    const m =
      (await db.prepare("SELECT mat_url AS n, title AS t, host_unit AS h, host_center_key AS hk, COALESCE(cover_key, edm_key) AS k, art_version AS v FROM courses WHERE series = ? AND mat_url = ? COLLATE NOCASE AND status = 'published'").bind(serRow.value, name).first<{ n: string; t: string; h: string; hk: string | null; k: string | null; v: number }>()) ??
      (await db.prepare("SELECT c.mat_url AS n, c.title AS t, c.host_unit AS h, c.host_center_key AS hk, COALESCE(c.cover_key, c.edm_key) AS k, c.art_version AS v FROM material_url_aliases a JOIN courses c ON c.id = a.course_id WHERE a.series = ? AND a.name = ? COLLATE NOCASE AND c.status = 'published'").bind(serRow.value, name).first<{ n: string; t: string; h: string; hk: string | null; k: string | null; v: number }>());
    if (!m) return null;
    const S = await shareCfg(db);
    return { title: titleOf(S, m.t), description: await describe(db, S), url: `${origin}/${serRow.slug}/${m.n}`, image: pubImage(origin, m.k, m.v) };
  }
  const center = hq ? null : await slugRow(db, slug, "center");
  if (!hq && !center) return null;
  const vs = urlNameVariants(name);
  const cols = "SELECT url_name AS n, title AS t, COALESCE(cover_key, edm_key) AS k, art_version AS v FROM courses WHERE";
  const c = await (center
    ? db.prepare(`${cols} host_center_key = ? AND url_name COLLATE NOCASE IN (${vs.map(() => "?").join(",")}) AND status = 'published'`).bind(centerKey(center.value), ...vs)
    : db.prepare(`${cols} host_center_key IS NULL AND url_name COLLATE NOCASE IN (${vs.map(() => "?").join(",")}) AND status = 'published'`).bind(...vs)
  ).first<{ n: string; t: string; k: string | null; v: number }>();
  let hit = c;
  if (!hit) {
    // 改名前的舊網址（別名）：預覽照常給，網址用目前的新網址。
    hit = await db
      .prepare(`SELECT c.url_name AS n, c.title AS t, COALESCE(c.cover_key, c.edm_key) AS k, c.art_version AS v FROM course_url_aliases a JOIN courses c ON c.id = a.course_id WHERE a.scope = ? AND a.url_name COLLATE NOCASE IN (${vs.map(() => "?").join(",")}) AND c.status = 'published' AND c.url_name IS NOT NULL`)
      .bind(center ? centerKey(center.value) : "", ...vs)
      .first<{ n: string; t: string; k: string | null; v: number }>()
      .catch(() => null);
  }
  if (!hit) return null;
  const S = await shareCfg(db);
  return { title: titleOf(S, hit.t), description: await describe(db, S), url: `${origin}/${center ? center.slug : HQ_SLUG}/${hit.n}`, image: pubImage(origin, hit.k, hit.v) };
}

/**
 * 分享預覽的單一入口（LINE 等不會執行 JavaScript，所以要由伺服器依網址帶出標題與圖）：
 * 所有會被分享出去的網址形狀都在這裡處理，新增網址形狀時加在這一個函式：
 *   /{縮寫}（分類／系列／中心短網址）、/{中心縮寫或hq}/{名字-001}（課程專屬網址）、
 *   /courses?center=…&category=…（沒設短網址的中心／分類）、/series/{系列名}、/course/{編號}、/learn/{課程}/{章節}。
 * 課程、章節只處理「已上架」的（未上架／封存一律用預設，避免洩漏未公開的名稱）；單堂課程與章節一律用它主辦中心的預覽卡片。找不到回 null＝維持預設標籤。
 */
export async function resolveShareMeta(db: D1Database, url: URL): Promise<ShareMeta | null> {
  const origin = url.origin;
  const path = url.pathname;
  const short = /^\/([A-Za-z0-9-]{2,30})$/.exec(path);
  if (short && !RESERVED_SLUGS.has(short[1]!.toLowerCase())) return shortLinkMeta(db, short[1]!, origin);
  const courseUrl = /^\/([A-Za-z0-9-]{2,30})\/([A-Za-z0-9-]{2,80})$/.exec(path);
  const first = courseUrl?.[1]?.toLowerCase() ?? "";
  if (courseUrl && (first === HQ_SLUG || !RESERVED_SLUGS.has(first)) && first !== "series") return courseUrlMeta(db, courseUrl[1]!, courseUrl[2]!, origin);

  if (path === "/courses") {
    const center = clip(url.searchParams.get("center"));
    const category = clip(url.searchParams.get("category"));
    if (!center && !category) return null;
    const S = await shareCfg(db);
    const card = center ? await centerCard(db, S, center) : null;
    const art = center ? await db.prepare("SELECT COALESCE(cover_key, edm_key) AS k, art_version AS v FROM center_art WHERE center_key = ?").bind(centerKey(center)).first<{ k: string; v: number }>().catch(() => null) : null;
    return { title: titleOf(S, [card?.name, category].filter(Boolean).join("・")), description: card ? card.description : await describe(db, S), url: `${origin}${path}${url.search}`, image: pubImage(origin, art?.k, art?.v) };
  }

  const series = /^\/series\/(.+)$/.exec(path);
  if (series) {
    let name = "";
    try {
      name = clip(decodeURIComponent(series[1]!));
    } catch {
      return null;
    }
    if (!name) return null;
    const S = await shareCfg(db);
    const art = await db.prepare("SELECT edm_key AS k, art_version AS v FROM series_art WHERE series = ?").bind(name).first<{ k: string; v: number }>().catch(() => null);
    return { title: titleOf(S, name), description: await describe(db, S), url: `${origin}${path}`, image: pubImage(origin, art?.k, art?.v) };
  }

  const course = /^\/course\/([\w-]+)$/.exec(path);
  const lesson = /^\/learn\/([\w-]+)\/([\w-]+)$/.exec(path);
  const courseId = course?.[1] ?? lesson?.[1];
  if (courseId) {
    const c = await db
      .prepare("SELECT title AS t, COALESCE(cover_key, edm_key) AS k, art_version AS v FROM courses WHERE id = ? AND status = 'published'")
      .bind(courseId)
      .first<{ t: string; k: string | null; v: number }>()
      .catch(() => null);
    if (!c) return null;
    const l = lesson ? await db.prepare("SELECT 1 AS ok FROM lessons WHERE id = ? AND course_id = ?").bind(lesson[2], courseId).first<{ ok: number }>().catch(() => null) : null;
    if (lesson && !l) return null;
    const S = await shareCfg(db);
    // 單堂課程與章節的預覽：標題用「課程名稱」（杜杜龍 2026-11-26），不再用主辦中心名稱。
    return { title: titleOf(S, c.t), description: await describe(db, S), url: `${origin}${path}`, image: pubImage(origin, c.k, c.v) };
  }
  return null;
}
