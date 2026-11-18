import { fetchYoutubeMeta } from "./youtube.ts";
import { classifyLink, LINK_DEFAULT_TITLE, parseHttpsUrl } from "./links.ts";

/**
 * 教材連結的名稱自動抓取（超級管理員／管理者貼上連結時用）：伺服器代為連線讀取網頁標題。
 * 安全：只連 https、擋內網與 IP 位址、最多跟隨 3 次轉址（每一次都重新檢查）、5 秒逾時、最多讀 256KB。
 * YouTube 走官方 oEmbed（拿得到影片標題）；其他網站讀 og:title 或 <title>；需要登入才看得到的頁面（標題只是「登入」）視為抓不到。
 */
const MAX_BYTES = 256 * 1024;
/** YouTube 影片頁：發布日期（itemprop／JSON）在 </head> 之後，要多讀一些（業主 2026-11-18：貼 YouTube 連結沒有帶出日期）。 */
const YT_MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const MAX_HOPS = 3;

/** 公開網站才允許連線：https、有網域（不是 IP）、不是本機或內部網域。 */
export function isPublicHost(u: URL): boolean {
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h === "localhost" || /\.(local|localhost|internal|lan|home|corp)$/.test(h)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.startsWith("[")) return false; // IPv4／IPv6 位址
  return true;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

/** 從網頁原始碼取標題：og:title 優先，其次 <title>。 */
export function extractTitle(html: string): string | null {
  const og = /<meta[^>]+(?:property|name)=["']og:title["'][^>]*content=["']([^"']*)["']/i.exec(html) ?? /<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']og:title["']/i.exec(html);
  const t = og?.[1] ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const clean = decode((t ?? "").replace(/\s+/g, " ")).trim();
  return clean || null;
}

/**
 * 從網頁原始碼取「發布日期」（業主 2026-11-18：教材日期自動讀連結的日期）：依序找 datePublished／uploadDate／article:published_time 等標記；
 * 回傳 YYYY-MM-DD，找不到或不合理（未來或太舊）回 null。
 */
export function extractDate(html: string): string | null {
  const pats = [
    /itemprop=["']datePublished["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*itemprop=["']datePublished["']/i,
    /itemprop=["']uploadDate["'][^>]*content=["']([^"']+)["']/i,
    /(?:property|name)=["']article:published_time["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*(?:property|name)=["']article:published_time["']/i,
    /(?:property|name)=["'](?:og:)?(?:pubdate|publish_date|date)["'][^>]*content=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/,
    /"uploadDate"\s*:\s*"([^"]+)"/,
    /"publishDate"\s*:\s*"([^"]+)"/,
  ];
  for (const re of pats) {
    const m = re.exec(html)?.[1]?.trim().slice(0, 10);
    if (m && /^\d{4}-\d{2}-\d{2}$/.test(m)) {
      const t = Date.parse(`${m}T00:00:00Z`);
      if (Number.isFinite(t) && t <= Date.now() + 86400_000 && t >= Date.parse("2000-01-01T00:00:00Z")) return m;
    }
  }
  return null;
}

/** 標題只是「請登入」之類（網頁需要登入才看得到內容）：不能當教材名稱。 */
const LOGIN_TITLE = /^(sign in|log in|login|登入|登錄|google (docs|drive|sheets|slides|forms)|notion|canva)(\s*[-–|:：].*)?$/i;
export const cleanFetchedTitle = (t: string | null): string | null => {
  if (!t) return null;
  const s = t.slice(0, 120).trim();
  return !s || LOGIN_TITLE.test(s) ? null : s;
};

async function readLimited(res: Response, wholePage = false): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, MAX_BYTES);
  const dec = new TextDecoder("utf-8", { fatal: false });
  let out = "";
  let n = 0;
  const cap = wholePage ? YT_MAX_BYTES : MAX_BYTES;
  while (n < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    out += dec.decode(value, { stream: true });
    if (wholePage ? /"(?:publishDate|uploadDate)"\s*:\s*"\d{4}-\d{2}-\d{2}|itemprop="datePublished"[^>]*content="\d{4}-\d{2}-\d{2}/.test(out) : /<\/head>/i.test(out)) break; // 標題都在 <head> 裡；YouTube 的發布日期在 <head> 之後，要讀到日期標記為止
  }
  await reader.cancel().catch(() => undefined);
  return out;
}

export type LinkInfo = { title: string | null; date: string | null };

/** 抓連結的名稱與發布日期；抓不到的欄位回 null。fetcher 可注入（測試用）。 */
export async function fetchLinkInfo(input: URL, fetcher: typeof fetch = fetch, ytKey?: string): Promise<LinkInfo> {
  let u = input;
  const none: LinkInfo = { title: null, date: null };
  if (!isPublicHost(u)) return none;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const headers = { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 (compatible; HglobalLearnBot/1.0)", "accept-language": "zh-TW,zh;q=0.9,en;q=0.8" };
  try {
    if (classifyLink(u) === "youtube") {
      // 標題走官方 oEmbed；發布日期要讀影片頁（兩個同時送）。
      const [o, pageRes] = await Promise.all([
        fetcher(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u.toString())}`, { signal: ctl.signal, headers: { accept: "application/json" } }).catch(() => null),
        fetcher(u.toString(), { signal: ctl.signal, headers: { ...headers, "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", cookie: "CONSENT=YES+1; SOCS=CAI" } }).catch(() => null),
      ]);
      // 有 YouTube 官方 API 金鑰就用它查發布日期（最可靠，不會被擋）；沒有才讀影片頁。
      let apiDate: string | null = null;
      if (ytKey) {
        const vid = u.hostname.replace(/^www\./, "") === "youtu.be" ? u.pathname.split("/")[1] : (u.searchParams.get("v") ?? /\/(?:shorts|embed|live)\/([\w-]{6,})/.exec(u.pathname)?.[1]);
        if (vid) apiDate = (await fetchYoutubeMeta(ytKey, [vid], fetcher)).get(vid)?.date ?? null;
      }
      const title = o?.ok ? cleanFetchedTitle(((await o.json()) as { title?: string }).title ?? null) : null;
      const date = apiDate ?? (pageRes?.ok ? extractDate(await readLimited(pageRes, true)) : null);
      if (title || date) return { title, date };
    }
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const res = await fetcher(u.toString(), { redirect: "manual", signal: ctl.signal, headers });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        const next = loc ? parseHttpsUrl(new URL(loc, u).toString()) : null;
        if (!next || !isPublicHost(next)) return none;
        u = next;
        continue;
      }
      if (!res.ok || !/text\/html|application\/xhtml/i.test(res.headers.get("content-type") ?? "")) return none;
      const html = await readLimited(res);
      return { title: cleanFetchedTitle(extractTitle(html)), date: extractDate(html) };
    }
    return none;
  } catch {
    return none;
  } finally {
    clearTimeout(timer);
  }
}

/** 抓連結的名稱；抓不到回 null（呼叫端改用類型的預設名稱）。 */
export async function fetchLinkTitle(input: URL, fetcher: typeof fetch = fetch): Promise<string | null> {
  return (await fetchLinkInfo(input, fetcher)).title;
}
