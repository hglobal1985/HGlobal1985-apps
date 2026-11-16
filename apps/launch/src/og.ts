import { centerKey } from "./central.ts";
import type { D1Database } from "./d1.ts";
import { RESERVED_SLUGS } from "./short-links.ts";

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

/** 中心的分享標題名稱：去掉數字代碼，結尾補「中心」（已以「中心」或「教育中心」結尾的先去掉，避免重複；業主 2026-11-15 指定預設為 XX中心）。「南京 062」→「南京中心」、「美國洛杉磯」→「美國洛杉磯中心」、「台北中心」→「台北中心」。 */
export function centerShareName(label: string): string {
  const base = label.replace(/\s*\d+\s*$/, "").replace(/教育中心$|中心$/, "").trim();
  return `${base || label}中心`;
}

/** 分享標題用的中心名稱：有自訂名稱就用自訂，沒有用預設格式。 */
export async function centerDisplayName(db: D1Database, label: string): Promise<string> {
  const r = await db.prepare("SELECT display_name AS n FROM center_names WHERE center_key = ?").bind(centerKey(label)).first<{ n: string }>().catch(() => null);
  return r?.n?.trim() || centerShareName(label);
}

/** 中心的分享標題：「彰化中心（地址）」；沒有設定地址就只有「彰化中心」（業主 2026-11-16）。 */
export async function centerShareTitle(db: D1Database, label: string): Promise<string> {
  const name = await centerDisplayName(db, label);
  const a = await db.prepare("SELECT address AS a FROM center_info WHERE center_key = ?").bind(centerKey(label)).first<{ a: string }>().catch(() => null);
  const address = a?.a?.trim();
  return address ? `${name}（${address}）` : name;
}

/** 短網址的分享預覽：標題「{名稱} | 寰宇行動大學」（中心的名稱是「{名稱去掉數字代碼}教育中心」），說明是隨機一句學習金句（設定頁編輯的那份）。找不到短網址回 null。 */
export async function shortLinkMeta(db: D1Database, slug: string, origin: string): Promise<{ title: string; description: string; url: string; image: string } | null> {
  const row = await db.prepare("SELECT kind, value FROM short_links WHERE slug = ?").bind(slug).first<{ kind: string; value: string }>();
  if (!row) return null;
  const q = await db.prepare("SELECT body FROM quotes ORDER BY RANDOM() LIMIT 1").first<{ body: string }>().catch(() => null);
  // 預覽圖：系列有上傳 EDM 就用 EDM；中心優先用「裁切好的 16:9 封面」（業主指定的位置），沒有封面才用整張 EDM；都沒有用網站圖示。
  const art =
    row.kind === "series"
      ? await db.prepare("SELECT edm_key AS k, art_version AS v FROM series_art WHERE series = ?").bind(row.value).first<{ k: string; v: number }>().catch(() => null)
      : row.kind === "center"
        ? await db.prepare("SELECT COALESCE(cover_key, edm_key) AS k, art_version AS v FROM center_art WHERE center_label = ?").bind(row.value).first<{ k: string; v: number }>().catch(() => null)
        : null;
  const image = art?.k ? `${origin}/api/v2/media/pub?k=${encodeURIComponent(art.k)}&v=${art.v}` : `${origin}/icon-512.png`;
  return { title: `${row.kind === "center" ? await centerShareTitle(db, row.value) : row.value} | ${SITE}`, description: q?.body?.trim() || SITE, url: `${origin}/${slug}`, image };
}

/** 課程專屬網址（/中心縮寫/英譯姓名-編號）的分享預覽：標題「{課程名稱} | 寰宇行動大學」，圖用課程封面（沒有就用 EDM、再沒有用網站圖示）。找不到回 null。 */
export async function courseUrlMeta(db: D1Database, slug: string, name: string, origin: string): Promise<{ title: string; description: string; url: string; image: string } | null> {
  const center = await db.prepare("SELECT value FROM short_links WHERE slug = ? AND kind = 'center'").bind(slug).first<{ value: string }>();
  if (!center) return null;
  const c = await db
    .prepare("SELECT title, subtitle, COALESCE(cover_key, edm_key) AS k, art_version AS v FROM courses WHERE host_center_key = ? AND url_name = ? AND status = 'published'")
    .bind(centerKey(center.value), name)
    .first<{ title: string; subtitle: string | null; k: string | null; v: number }>();
  if (!c) return null;
  const q = await db.prepare("SELECT body FROM quotes ORDER BY RANDOM() LIMIT 1").first<{ body: string }>().catch(() => null);
  const image = c.k ? `${origin}/api/v2/media/pub?k=${encodeURIComponent(c.k)}&v=${c.v}` : `${origin}/icon-512.png`;
  return { title: `${c.title} | ${SITE}`, description: c.subtitle?.trim() || q?.body?.trim() || SITE, url: `${origin}/${slug}/${name}`, image };
}

type ShareMeta = { title: string; description: string; url: string; image: string };

const clip = (v: string | null | undefined, n = 60) => (v ?? "").trim().slice(0, n);
const pubImage = (origin: string, k: string | null | undefined, v: number | null | undefined) => (k ? `${origin}/api/v2/media/pub?k=${encodeURIComponent(k)}&v=${v ?? 0}` : `${origin}/icon-512.png`);
const randomQuote = async (db: D1Database) => (await db.prepare("SELECT body FROM quotes ORDER BY RANDOM() LIMIT 1").first<{ body: string }>().catch(() => null))?.body?.trim() || "";

/**
 * 分享預覽的單一入口（LINE 等不會執行 JavaScript，所以要由伺服器依網址帶出標題與圖）：
 * 所有會被分享出去的網址形狀都在這裡處理，新增網址形狀時加在這一個函式：
 *   /{縮寫}（分類／系列／中心短網址）、/{中心縮寫}/{名字-001}（課程專屬網址）、
 *   /courses?center=…&category=…（沒設短網址的中心／分類）、/series/{系列名}、/course/{編號}、/learn/{課程}/{章節}。
 * 課程、章節只處理「已上架」的（未上架／封存一律用預設，避免洩漏未公開的名稱）。找不到回 null＝維持預設標籤。
 */
export async function resolveShareMeta(db: D1Database, url: URL): Promise<ShareMeta | null> {
  const origin = url.origin;
  const path = url.pathname;
  const short = /^\/([a-z0-9-]{2,30})$/.exec(path);
  if (short && !RESERVED_SLUGS.has(short[1]!)) return shortLinkMeta(db, short[1]!, origin);
  const courseUrl = /^\/([a-z0-9-]{2,30})\/([a-z0-9-]{3,80})$/.exec(path);
  if (courseUrl && !RESERVED_SLUGS.has(courseUrl[1]!) && courseUrl[1] !== "series") return courseUrlMeta(db, courseUrl[1]!, courseUrl[2]!, origin);

  if (path === "/courses") {
    const center = clip(url.searchParams.get("center"));
    const category = clip(url.searchParams.get("category"));
    if (!center && !category) return null;
    const name = center ? await centerShareTitle(db, center) : "";
    const art = center ? await db.prepare("SELECT COALESCE(cover_key, edm_key) AS k, art_version AS v FROM center_art WHERE center_key = ?").bind(centerKey(center)).first<{ k: string; v: number }>().catch(() => null) : null;
    return { title: `${[name, category].filter(Boolean).join("・")} | ${SITE}`, description: (await randomQuote(db)) || SITE, url: `${origin}${path}${url.search}`, image: pubImage(origin, art?.k, art?.v) };
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
    const art = await db.prepare("SELECT edm_key AS k, art_version AS v FROM series_art WHERE series = ?").bind(name).first<{ k: string; v: number }>().catch(() => null);
    return { title: `${name} | ${SITE}`, description: (await randomQuote(db)) || SITE, url: `${origin}${path}`, image: pubImage(origin, art?.k, art?.v) };
  }

  const course = /^\/course\/([\w-]+)$/.exec(path);
  const lesson = /^\/learn\/([\w-]+)\/([\w-]+)$/.exec(path);
  const courseId = course?.[1] ?? lesson?.[1];
  if (courseId) {
    const c = await db
      .prepare("SELECT title, subtitle, COALESCE(cover_key, edm_key) AS k, art_version AS v FROM courses WHERE id = ? AND status = 'published'")
      .bind(courseId)
      .first<{ title: string; subtitle: string | null; k: string | null; v: number }>()
      .catch(() => null);
    if (!c) return null;
    const l = lesson ? await db.prepare("SELECT title FROM lessons WHERE id = ? AND course_id = ?").bind(lesson[2], courseId).first<{ title: string }>().catch(() => null) : null;
    if (lesson && !l) return null;
    return { title: `${l ? `${c.title}｜${l.title}` : c.title} | ${SITE}`, description: c.subtitle?.trim() || (await randomQuote(db)) || SITE, url: `${origin}${path}`, image: pubImage(origin, c.k, c.v) };
  }
  return null;
}
