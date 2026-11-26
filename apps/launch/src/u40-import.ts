import type { D1Database } from "./d1.ts";
import { fetchYoutubeMeta } from "./youtube.ts";
import { readPlaylist } from "./imports.ts";
import { romanizeTitle } from "./romanize.ts";

/**
 * U40創業學院「播放清單 → 課程」一次性匯入（杜杜龍 2026-11-20；不納入「同步 YouTube 清單」，之後不再更新）：
 * 每個播放清單＝一門課（設定照示範課程複製，只換標題與起訖日期，沒有封面圖＝純文字封面）；
 * 清單裡每支影片＝一個區塊「第N堂」，區塊裡一個教材（外部連結＝這支影片的單支網址，名稱／日期／主講人／獎銜取自影片）。
 * 匯入工作：kind=playlist、block_id=`pcourse:示範課程編號|開始日|結束日`、url=播放清單編號、title=課程名稱。
 */

const SERIES_WORDS = ["你所不知道的安麗", "你不知道的安麗", "致富的黃金八法", "成功的八大習慣", "創玩家創玩計畫", "AI知識變現術", "視野造就財富", "創玩家培訓", "創業家培訓", "創玩計劃", "創玩計畫", "你的收入該升級了", "創業學院", "創客九力", "系統複製", "潮流創業", "U40"];
const CN = "一二三四五六七八九十";
const RANKS: [RegExp, string][] = [
  [/F\s*白金$/i, "f_platinum"], [/F\s*鑽石$/i, "f_diamond"], [/F\s*翡翠$/i, "f_emerald"], [/白金$/, "platinum"], [/鑽石$/, "diamond"], [/翡翠$/, "emerald"], [/EDC$/i, "exec_diamond"], [/明珠$/, "pearl"], [/藍寶石$/, "sapphire"],
];

export type ParsedTitle = { date: string | null; name: string; seq: number | null; speaker: string; rank: string };

/** 從影片標題判讀：日期（標題寫的）、教材名稱（拿掉日期、系列字樣、編號；沒有適當名稱＝空字串）、堂次、主講人與獎銜（只取第一位，兩位以上時名稱保留全部）。 */
export function parseVideoTitle(raw: string): ParsedTitle {
  let t = raw.replace(/\s+/g, " ");
  let date: string | null = null;
  const m = /(20\d{2})(\d{2})(\d{2})(?!\d)/.exec(t) ?? /(20\d{2})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(t);
  if (m) {
    date = `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
    t = t.replace(m[0], " ");
  }
  // 「蘇致豪翡翠、魏程緯白金、主持黃子芯（…）」：主講人（姓名＋獎銜）列表，主持人不建檔。
  const host = /(?:^|[\s、,，])主持/.exec(t);
  if (host) {
    const parts = t.slice(0, host.index).split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
    const parsed = parts.map((p) => RANKS.map(([re, code]) => (re.test(p) ? { name: p.replace(re, "").trim(), code } : null)).find(Boolean) ?? null);
    if (parts.length && parsed.every(Boolean)) return { date, name: parts.join("、"), seq: null, speaker: parsed[0]!.name, rank: parsed[0]!.code };
  }
  let speaker = "";
  t = t.replace(/主講[:：]\s*([^\s、，（(]+)/, (_x, n: string) => ((speaker = n), " "));
  let seq: number | null = null;
  t = t.replace(/[（(]\s*(?:20\d{2}[^）)]*|[^）)]*U40[^）)]*)[）)]/g, " "); // 結尾的（2024/02/03 U40潮流創業）
  t = t.replace(/[（(](\d{1,2})[）)]/, (_x, n: string) => ((seq ??= Number(n)), " "));
  t = t.replace(/(\d)️?⃣/, (_x, n: string) => ((seq ??= Number(n)), " "));
  t = t.replace(/[➊-➓]/, (c) => ((seq ??= c.charCodeAt(0) - 0x278a + 1), " "));
  t = t.replace(/第([一二三四五六七八九十\d]+)[堂法]/, (x, n: string) => {
    seq ??= /^\d+$/.test(n) ? Number(n) : CN.indexOf(n) + 1 || null;
    return ` ${x} `;
  });
  for (const w of SERIES_WORDS) t = t.split(w).join(" ");
  t = t.replace(/^[\s\-－~～:：·、，,]+|[\s\-－~～:：·、，,]+$/g, "");
  t = t.replace(/^第[一二三四五六七八九十\d]+[堂法][\s\-－~～:：·]*/, "").replace(/^[\s\-－~～:：·]+/, "").trim();
  return { date, name: t.length >= 2 ? t.slice(0, 80) : "", seq, speaker, rank: "" };
}

/** 排序：每支影片都有明確堂次就依堂次，否則依日期（標題日期比上傳日還晚＝標題打錯年份，改用上傳日；事後才上傳的舊影片仍用標題上的上課日）；沒日期的放最後。 */
export function orderVideos<T extends { p: ParsedTitle; up: string | null }>(items: T[]): (T & { day: string | null })[] {
  const dated = items.map((it) => {
    let day = it.p.date;
    if (day && it.up && Date.parse(day) > Date.parse(it.up) + 2 * 86400_000) day = it.up; // 影片不可能在上課日之前上傳：標題日期比上傳日還晚＝標題打錯年份
    return { ...it, day: day ?? it.up };
  });
  const bySeq = dated.every((d) => d.p.seq !== null) && new Set(dated.map((d) => d.p.seq)).size === dated.length;
  return [...dated].sort((a, b) => (bySeq ? a.p.seq! - b.p.seq! : (a.day ?? "9999").localeCompare(b.day ?? "9999")));
}

const short = () => crypto.randomUUID().slice(0, 6);
const KEEP_OUT = new Set(["id", "title", "event_start", "event_end", "created_at", "updated_at", "edited_by_name", "edited_at", "sort_order", "series_order", "edm_key", "cover_key", "cover_bg_id", "art_version", "cover_rect", "edm_view_y", "url_name", "mat_url"]);

export async function runPlaylistCourse(db: D1Database, job: { block_id: string; url: string; title: string }, key: string): Promise<{ imported: number; note: string }> {
  const [tplId, start, end] = job.block_id.slice("pcourse:".length).split("|");
  const tpl = await db.prepare("SELECT * FROM courses WHERE id = ?").bind(tplId).first<Record<string, unknown>>();
  if (!tpl) return { imported: 0, note: "找不到示範課程" };
  const title = job.title.trim();
  const series = String(tpl.series ?? "");
  if (await db.prepare("SELECT 1 AS x FROM courses WHERE series = ? AND title = ?").bind(series, title).first()) return { imported: 0, note: `沒有新的影片可匯入（「${title}」已存在）` };
  const read = await readPlaylist(key, job.url, new Set());
  if ("error" in read) return { imported: 0, note: read.error };
  if (!read.items.length) return { imported: 0, note: "清單是空的或非公開" };
  const meta = await fetchYoutubeMeta(key, read.items.map((i) => i.id));
  const ordered = orderVideos(read.items.map((it) => ({ it, p: parseVideoTitle(it.title), up: meta.get(it.id)?.date ?? it.date, sec: meta.get(it.id)?.seconds ?? null })));
  const cid = `c${short()}${short().slice(0, 1)}`;
  const now = new Date().toISOString();
  const cols = (await db.prepare("SELECT name FROM pragma_table_info('courses')").all<{ name: string }>()).results.map((c) => c.name).filter((c) => !KEEP_OUT.has(c));
  const max = (await db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM courses").first<{ m: number }>())?.m ?? 0;
  // 專屬網址（總部）：課程名稱英譯＋編號，避開現有與舊網址。
  let urlName: string | null = null;
  const base = romanizeTitle(title);
  if (base) {
    const like = `${base.replace(/[%_\\]/g, "")}-%`;
    const used = await db.prepare("SELECT url_name FROM courses WHERE host_center_key IS NULL AND url_name LIKE ? ESCAPE '\\'").bind(like).all<{ url_name: string }>();
    const olds = await db.prepare("SELECT url_name FROM course_url_aliases WHERE scope = '' AND url_name LIKE ? ESCAPE '\\'").bind(like).all<{ url_name: string }>().catch(() => ({ results: [] as { url_name: string }[] }));
    let n = 0;
    for (const r of [...used.results, ...olds.results]) {
      const mm = /-(\d+)$/.exec(r.url_name);
      if (mm && r.url_name.slice(0, -mm[0].length) === base) n = Math.max(n, Number(mm[1]));
    }
    urlName = `${base}-${n + 1}`;
  }
  const row: Record<string, unknown> = { id: cid, title, event_start: start || null, event_end: end || null, sort_order: max + 1, url_name: urlName, created_at: now, updated_at: now, edited_by_name: "系統匯入", edited_at: now, art_version: 0 };
  for (const c of cols) row[c] = tpl[c];
  const keys = Object.keys(row);
  const stmts = [db.prepare(`INSERT INTO courses (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).bind(...keys.map((k) => row[k] ?? null))];
  const lines: string[] = [];
  let pos = 1;
  ordered.forEach((v, i) => {
    const label = `第${i + 1}堂`;
    const name = v.p.name || label;
    const bid = `${cid}-${short()}`;
    const mid = `${cid}-${short()}`;
    stmts.push(db.prepare("INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type, kind, in_sheet) VALUES (?, ?, ?, ?, 0, 'demo', 'section', 1)").bind(bid, cid, pos++, label));
    stmts.push(db.prepare("INSERT INTO lessons (id, course_id, position, title, sharer, sharer_rank, duration_minutes, media_type, event_date, kind) VALUES (?, ?, ?, ?, ?, ?, ?, 'demo', ?, 'material')").bind(mid, cid, pos++, name, v.p.speaker, v.p.rank, v.sec ? Math.round(v.sec / 60) : 0, v.day));
    stmts.push(db.prepare("INSERT INTO lesson_attachments (id, lesson_id, course_id, name, kind, link_url, att_type, created_by) VALUES (?, ?, ?, ?, 'link', ?, 'youtube', 'system')").bind(crypto.randomUUID(), mid, cid, name, `https://www.youtube.com/watch?v=${v.it.id}`));
    lines.push(`${label}｜${v.day ?? "無日期"}｜${name}｜${v.p.speaker}${v.p.rank ? `（${v.p.rank}）` : ""}｜原標題：${v.it.title}`);
  });
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return { imported: ordered.length, note: `${cid}｜${urlName ?? "無網址"}\n${lines.join("\n")}`.slice(0, 4000) };
}
