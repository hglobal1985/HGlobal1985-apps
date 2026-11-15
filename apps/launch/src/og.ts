import { centerKey } from "./central.ts";
import type { D1Database } from "./d1.ts";

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
  return { title: `${row.kind === "center" ? await centerDisplayName(db, row.value) : row.value} | ${SITE}`, description: q?.body?.trim() || SITE, url: `${origin}/${slug}`, image };
}
