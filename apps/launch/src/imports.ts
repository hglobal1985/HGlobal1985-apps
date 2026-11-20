import { classifyLink } from "./links.ts";
import type { D1Database, Env } from "./d1.ts";
import { loadConfig } from "./ui-config.ts";
import { shrinkImage } from "./image-store.ts";
import { youtubeId } from "./api.ts";
import { taipeiDay } from "./youtube.ts";

type Job = { id: string; course_id: string; block_id: string; kind: "playlist" | "video" | "cover" | "photo" | "link"; url: string; title: string; start_sec: number | null };
const short = () => crypto.randomUUID().slice(0, 6);

/** 把新建的教材放到某區塊的最後面（區塊＝到下一個區塊標題之前），完整版課程影片永遠在最後；順序重新編號。 */
async function placeInBlock(db: D1Database, courseId: string, blockId: string, newIds: string[]): Promise<void> {
  if (!newIds.length) return;
  const { results } = await db.prepare("SELECT id, kind, is_full FROM lessons WHERE course_id = ? ORDER BY position").bind(courseId).all<{ id: string; kind: string; is_full: number }>();
  const fresh = new Set(newIds);
  const rest = results.filter((r) => !fresh.has(r.id) && r.is_full !== 1);
  const at = rest.findIndex((r) => r.id === blockId);
  let end = at < 0 ? rest.length : at + 1;
  while (at >= 0 && end < rest.length && rest[end]!.kind !== "section") end++;
  const order = [...rest.slice(0, end).map((r) => r.id), ...newIds, ...rest.slice(end).map((r) => r.id), ...results.filter((r) => r.is_full === 1).map((r) => r.id)];
  await db.batch([db.prepare("UPDATE lessons SET position = -position WHERE course_id = ?").bind(courseId), ...order.map((id, i) => db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(i + 1, id))]);
}

/** 把新建的教材放到這份清單所有教材（含區塊）的最前面，完整版課程影片永遠在最後；順序重新編號。 */
async function placeOnTop(db: D1Database, courseId: string, newIds: string[]): Promise<void> {
  if (!newIds.length) return;
  const { results } = await db.prepare("SELECT id, kind, is_full FROM lessons WHERE course_id = ? ORDER BY position").bind(courseId).all<{ id: string; kind: string; is_full: number }>();
  const fresh = new Set(newIds);
  const rest = results.filter((r) => !fresh.has(r.id) && r.is_full !== 1);
  let at = rest.findIndex((r) => r.kind === "material" || r.kind === "section");
  if (at < 0) at = rest.length;
  const order = [...rest.slice(0, at).map((r) => r.id), ...newIds, ...rest.slice(at).map((r) => r.id), ...results.filter((r) => r.is_full === 1).map((r) => r.id)];
  await db.batch([db.prepare("UPDATE lessons SET position = -position WHERE course_id = ?").bind(courseId), ...order.map((id, i) => db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(i + 1, id))]);
}

/**
 * 同步來的教材卡一律「日期最新的在最上面」（業主 2026-11-20 回報舊影片被放到最下面）：把這張卡的教材依活動日期由新到舊重排
 * （同一天維持原順序、沒有日期的放最後；章節在最前面、「完整版課程影片」在最後）。有區塊的卡是手動編排，不動。
 */
export async function sortMaterialsByDate(db: D1Database, courseId: string): Promise<number> {
  const { results } = await db.prepare("SELECT id, kind, is_full, event_date FROM lessons WHERE course_id = ? ORDER BY position").bind(courseId).all<{ id: string; kind: string; is_full: number; event_date: string | null }>();
  if (results.some((r) => r.kind === "section")) return 0;
  const lead = results.filter((r) => r.kind !== "material" && r.is_full !== 1);
  const mats = results.filter((r) => r.kind === "material" && r.is_full !== 1);
  const tail = results.filter((r) => r.is_full === 1);
  const sorted = [...mats].sort((a, b) => (b.event_date || "").localeCompare(a.event_date || "")); // Array.sort 是穩定排序：同一天維持原順序
  const order = [...lead, ...sorted, ...tail].map((r) => r.id);
  if (order.every((id, i) => id === results[i]!.id)) return 0;
  await db.batch([db.prepare("UPDATE lessons SET position = -position WHERE course_id = ?").bind(courseId), ...order.map((id, i) => db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(i + 1, id))]);
  return order.length;
}

const nextPos = async (db: D1Database, courseId: string) => ((await db.prepare("SELECT COALESCE(MAX(position), 0) AS m FROM lessons WHERE course_id = ?").bind(courseId).first<{ m: number }>())?.m ?? 0) + 1;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };

async function fetchImage(url: string, side: number): Promise<{ data: ArrayBuffer; type: string } | null> {
  const u = url.replace(/=w\d+(?=$|[-&])/, `=w${side}`);
  const res = await fetch(u, { headers: { accept: "image/*" } }).catch(() => null);
  const type = (res?.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (!res?.ok || !EXT[type]) return null;
  const data = await res.arrayBuffer();
  return data.byteLength > 0 && data.byteLength <= 8 * 1024 * 1024 ? { data, type } : null;
}

type PlItem = { id: string; title: string; date: string | null };
/** 讀 YouTube 播放清單（官方 API，最多 300 支）：略過私人／已刪除與 skip 裡已有的影片（讀到的也加進 skip，清單內重複的只留一支）。 */
async function readPlaylist(key: string, playlistId: string, skip: Set<string>): Promise<{ items: PlItem[] } | { error: string }> {
  const items: PlItem[] = [];
  let token = "";
  for (let page = 0; page < 6; page++) {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${encodeURIComponent(playlistId)}&key=${encodeURIComponent(key)}${token ? `&pageToken=${token}` : ""}`, { headers: { accept: "application/json" } }).catch(() => null);
    if (!res?.ok) return { error: `讀取播放清單失敗（${res?.status ?? "連線錯誤"}）` };
    const data = (await res.json()) as { items?: { snippet?: { title?: string }; contentDetails?: { videoId?: string; videoPublishedAt?: string } }[]; nextPageToken?: string };
    for (const it of data.items ?? []) {
      const id = it.contentDetails?.videoId;
      const title = it.snippet?.title ?? "";
      if (!id || /^(private video|deleted video)$/i.test(title) || skip.has(id)) continue;
      skip.add(id);
      items.push({ id, title: title.slice(0, 120), date: taipeiDay(it.contentDetails?.videoPublishedAt) });
    }
    if (!data.nextPageToken) break;
    token = data.nextPageToken;
  }
  return { items };
}

/**
 * 依影片標題判讀主辦中心（業主 2026-11-19）：標題裡有中央清單某中心的名稱（去掉尾巴代碼與「中心」二字）就算；
 * 先比完整名稱（取最長的唯一一個），沒有再比名稱最後兩個字（例：標題寫「屏東」→「圓滿屏東中心 221」），只有唯一符合才採用；
 * 沒寫或有歧義就回空字串（不勾任何中心）。centers 只能是中央清單（central_snapshots），不混入本地資料。
 */
export function guessCenter(title: string, centers: string[]): string {
  const core = (c: string) => c.replace(/\s*\d+\s*$/, "").replace(/中心$/, "").replace(/\s+/g, "");
  const t = title.replace(/\s+/g, "");
  const pick = (hits: string[]) => (hits.length === 1 ? hits[0]! : "");
  const full = centers.filter((c) => core(c).length >= 2 && t.includes(core(c)));
  if (full.length) {
    const longest = Math.max(...full.map((c) => core(c).length));
    return pick(full.filter((c) => core(c).length === longest));
  }
  const tail = centers.filter((c) => core(c).length >= 3 && t.includes(core(c).slice(-2)));
  return pick(tail);
}

/** 銅章會議這類「課程播放清單」匯入的欄位不照抄（其餘全部照示範課程的設定，包含費用、獎銜、審核群組、誰能瀏覽…）。 */
const NOT_COPIED = new Set(["id", "title", "subtitle", "teacher", "host_unit", "host_center_key", "event_start", "event_end", "created_at", "updated_at", "edited_by_name", "edited_at", "created_by_sub", "sort_order", "series_order", "edm_key", "cover_key", "cover_bg_id", "art_version", "cover_rect", "edm_view_y", "url_name", "status", "teacher_rank", "teacher_title", "mat_url"]);

/**
 * 播放清單 → 課程（業主 2026-11-19）：每支影片建一門課，設定照「示範課程」（job.course_id）複製；
 * 名稱＝「銅章會議X年X月」（X 取影片上傳日期），日期＝影片上傳日期，一個章節＝這支影片，主辦中心依標題判讀。
 * 先建成「草稿」，確認後再上架（note 會列出每支影片判讀的中心）。已經在同系列課程裡的影片不重複建立。
 */
async function runCoursePlaylist(db: D1Database, job: Job, key: string, have: Set<string>): Promise<{ imported: number; note: string }> {
  const tplId = job.block_id.slice("course:".length);
  const tpl = await db.prepare("SELECT * FROM courses WHERE id = ?").bind(tplId).first<Record<string, unknown>>();
  if (!tpl) return { imported: 0, note: "找不到示範課程" };
  const series = String(tpl.series ?? "");
  const dupes = await db.prepare("SELECT l.media_ref FROM lessons l JOIN courses c ON c.id = l.course_id WHERE c.series = ? AND l.media_ref IS NOT NULL").bind(series).all<{ media_ref: string }>();
  for (const r of dupes.results) have.add(r.media_ref);
  const read = await readPlaylist(key, job.url, have);
  if ("error" in read) return { imported: 0, note: read.error };
  if (!read.items.length) return { imported: 0, note: "沒有新的影片可匯入（可能都已存在，或清單是空的／非公開）" };
  const snap = await db.prepare("SELECT value FROM central_snapshots WHERE key = 'centers'").first<{ value: string }>();
  const centers: string[] = (() => { try { return (JSON.parse(snap?.value ?? "[]") as unknown[]).filter((x): x is string => typeof x === "string"); } catch { return []; } })();
  const cols = (await db.prepare("SELECT name FROM pragma_table_info('courses')").all<{ name: string }>()).results.map((c) => c.name).filter((c) => !NOT_COPIED.has(c));
  const prefix = String(tpl.title ?? "").replace(/\s*\d{4}\s*年.*$/, "").trim() || series;
  const lines: string[] = [];
  const stmts = [];
  for (const it of [...read.items].reverse()) {
    const date = it.date ?? "";
    const m = /^(\d{4})-(\d{2})/.exec(date);
    const name = m ? `${prefix}${m[1]}年${Number(m[2])}月` : prefix;
    const center = guessCenter(it.title, centers);
    const id = `c${short()}${short().slice(0, 1)}`;
    const base: Record<string, unknown> = { id, title: name, host_unit: center, host_center_key: center, event_start: date || null, status: "draft" };
    for (const c of cols) base[c] = tpl[c];
    const keys = Object.keys(base);
    stmts.push(db.prepare(`INSERT INTO courses (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).bind(...keys.map((k) => base[k] ?? null)));
    stmts.push(db.prepare("INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type, media_ref, kind) VALUES (?, ?, 1, ?, 0, 'youtube', ?, 'chapter')").bind(`${id}-${short()}`, id, name, it.id));
    lines.push(`${name}｜${center || "（未判讀）"}｜${it.title}`);
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return { imported: read.items.length, note: lines.join("\n").slice(0, 4000) };
}

async function runJob(env: Env, job: Job, key: string | undefined, side: number): Promise<{ imported: number; note: string }> {
  const db = env.DB;
  if (job.kind === "playlist") {
    if (!key) return { imported: 0, note: "尚未設定 YouTube 金鑰" };
    const have = new Set((await db.prepare("SELECT media_ref FROM lessons WHERE course_id = ? AND media_ref IS NOT NULL").bind(job.course_id).all<{ media_ref: string }>()).results.map((r) => r.media_ref));
    if (job.block_id.startsWith("course:")) return runCoursePlaylist(db, job, key, have);
    const read = await readPlaylist(key, job.url, have);
    if ("error" in read) return { imported: 0, note: read.error };
    const items = read.items;
    if (!items.length) return { imported: 0, note: "沒有新的影片可匯入（可能都已存在，或清單是空的／非公開）" };
    let pos = await nextPos(db, job.course_id);
    const ids = items.map(() => `${job.course_id}-${short()}`);
    await db.batch(items.map((it, i) => db.prepare("INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type, media_ref, event_date, kind) VALUES (?, ?, ?, ?, 0, 'youtube', ?, ?, 'material')").bind(ids[i]!, job.course_id, pos++, it.title || "影片", it.id, it.date)));
    await placeInBlock(db, job.course_id, job.block_id, ids);
    return { imported: items.length, note: "" };
  }
  if (job.kind === "video") {
    const vid = youtubeId(job.url);
    if (!vid) return { imported: 0, note: "不是有效的 YouTube 影片網址" };
    const id = `${job.course_id}-${short()}`;
    await db.prepare("INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type, media_ref, start_seconds, kind) VALUES (?, ?, ?, ?, 0, 'youtube', ?, ?, 'material')").bind(id, job.course_id, await nextPos(db, job.course_id), job.title.slice(0, 120) || "影片", vid, job.start_sec).run();
    await placeInBlock(db, job.course_id, job.block_id, [id]);
    return { imported: 1, note: "" };
  }
  if (job.kind === "link") {
    const u = new URL(job.url);
    const id = `${job.course_id}-${short()}`;
    await db.batch([
      db.prepare("INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type, kind) VALUES (?, ?, ?, ?, 0, 'demo', 'material')").bind(id, job.course_id, await nextPos(db, job.course_id), job.title.slice(0, 120) || "連結"),
      db.prepare("INSERT INTO lesson_attachments (id, lesson_id, course_id, name, kind, link_url, att_type, created_by) VALUES (?, ?, ?, ?, 'link', ?, ?, 'system')").bind(crypto.randomUUID(), id, job.course_id, job.title.slice(0, 120) || "連結", u.toString(), classifyLink(u)),
    ]);
    await placeInBlock(db, job.course_id, job.block_id, [id]);
    return { imported: 1, note: "" };
  }
  // cover / photo：下載圖片（依「圖片壓縮長邊」設定向來源要求縮小版）存進 R2
  const bucket = env.MEDIA;
  if (!bucket) return { imported: 0, note: "檔案儲存空間尚未啟用" };
  const raw = await fetchImage(job.url, side);
  if (!raw) return { imported: 0, note: "圖片下載失敗" };
  const shr = await shrinkImage(env, raw.data, raw.type, "general");
  const img = { data: shr.data, type: shr.type };
  const ext = EXT[img.type]!;
  if (job.kind === "cover") {
    const k = `lesson/${job.block_id}/${crypto.randomUUID()}.${ext}`;
    await bucket.put(k, img.data, { httpMetadata: { contentType: img.type } });
    await db.prepare("UPDATE lessons SET cover_key = ?, art_version = art_version + 1 WHERE id = ?").bind(k, job.block_id).run();
    return { imported: 1, note: "" };
  }
  const id = `${job.course_id}-${short()}`;
  const k = `file/${job.course_id}/${crypto.randomUUID()}/photo.${ext}`;
  await bucket.put(k, img.data, { httpMetadata: { contentType: img.type } });
  const name = `${job.title || "照片"}.${ext}`;
  await db.batch([
    db.prepare("INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type, kind) VALUES (?, ?, ?, ?, 0, 'demo', 'material')").bind(id, job.course_id, await nextPos(db, job.course_id), (job.title || "照片").slice(0, 120)),
    db.prepare("INSERT INTO lesson_attachments (id, lesson_id, course_id, name, r2_key, size, content_type, kind, att_type, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'file', 'image', 'system')").bind(crypto.randomUUID(), id, job.course_id, name, k, img.data.byteLength, img.type),
  ]);
  await placeInBlock(db, job.course_id, job.block_id, [id]);
  return { imported: 1, note: "" };
}

/** 排程處理匯入工作（每次最多 8 個，依 seq 順序）；沒有待處理的工作時只有一個很小的查詢。 */
export async function processImportJobs(env: Env, limit = 8): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id, course_id, block_id, kind, url, title, start_sec FROM import_jobs WHERE status = 'pending' ORDER BY seq, created_at LIMIT ?").bind(limit).all<Job>();
  if (!results.length) return 0;
  const side = (await loadConfig(env.DB)).app.imageMaxSide;
  for (const job of results) {
    let out: { imported: number; note: string };
    try {
      out = await runJob(env, job, env.YOUTUBE_API_KEY, side);
    } catch (e) {
      out = { imported: 0, note: e instanceof Error ? e.message.slice(0, 200) : "error" };
    }
    // 沒金鑰的播放清單留著等金鑰設好再做；其他失敗標記 failed（note 寫原因）。
    if (job.kind === "playlist" && !env.YOUTUBE_API_KEY) continue;
    await env.DB.prepare("UPDATE import_jobs SET status = ?, imported = ?, note = ?, done_at = ? WHERE id = ?").bind(out.imported > 0 || out.note.startsWith("沒有新的") ? "done" : "failed", out.imported, out.note, new Date().toISOString(), job.id).run();
  }
  return results.length;
}

/** 從 YouTube 播放清單網址取出清單編號（list= 參數，或直接貼清單編號）；不是清單網址回 null。 */
export function playlistIdOf(input: string): string | null {
  const t = input.trim();
  if (/^[A-Za-z0-9_-]{10,60}$/.test(t) && /^(PL|UU|OL|FL|RD)/.test(t)) return t;
  try {
    const u = new URL(t);
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)) return null;
    const id = u.searchParams.get("list");
    return id && /^[A-Za-z0-9_-]{10,60}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** 命名規則可用的代入欄位（設定頁顯示同一份說明）。 */
export const SYNC_FORMAT_HELP = "可用：{年}、{月}、{日}（年月日，影片標題寫的優先，沒有就用影片日期）、{主持}（從標題判讀，判讀不到就連同它所在的括號一起省略）、{標題}（影片原標題）";

/** 沒有填規則時的預設：「2026年11月 名稱（主持xxx）」。 */
export const defaultSyncFormat = (name: string): string => `{年}年{月}月 ${name}（主持{主持}）`;

/**
 * 同步清單產生的教材名稱（業主 2026-11-20）：依這份同步自己的「命名規則」代入。
 * 例：規則「{年}年{月}月{日}日 王老師小線對焦」＋影片日期 2026-03-14 →「2026年3月14日 王老師小線對焦」。
 * 年月先看影片標題裡寫的「2026年11月」，沒有就用影片日期；日期判讀不到的欄位連同後面的單位字（年／月／日）一起省略。
 */
export function syncTitle(format: string, videoTitle: string, date: string | null): string {
  const t = videoTitle.replace(/\s+/g, " ");
  const ym = /(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*[日號])?/.exec(t);
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  const year = ym ? ym[1]! : d ? d[1]! : "";
  const month = ym ? String(Number(ym[2])) : d ? String(Number(d[2])) : "";
  // 日：標題有寫就用；否則影片日期的月份與（標題或影片）月份一致時才用影片日期。
  const day = ym?.[3] ? String(Number(ym[3])) : d && (!ym || Number(ym[2]) === Number(d[2])) ? String(Number(d[3])) : "";
  const host = /主持(?:人)?\s*[:：]?\s*([^\s（）()【】[\]|｜,，、/／\-－—~～]{1,8})/.exec(t)?.[1] ?? "";
  return format
    .replace(/[（(][^（）()]*\{主持\}[^（）()]*[）)]/g, (m) => (host ? m : ""))
    .replace(/\{年\}\s*年?/g, year ? `${year}年` : "")
    .replace(/\{月\}\s*月?/g, month ? `${month}月` : "")
    .replace(/\{日\}\s*[日號]?/g, day ? `${day}日` : "")
    .replace(/\{主持\}/g, host)
    .replace(/\{標題\}/g, t)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 同步一份 YouTube 播放清單到教材卡（業主 2026-11-20）：只加還沒有的影片（用影片編號比對，已存在的不重複），
 * 每支影片一個教材（不開區塊），名稱依 syncTitle，日期＝影片日期，分鐘數由排程補。結果記在這份同步設定上。
 */
export async function runYoutubeSync(env: Env, syncId: string): Promise<{ imported: number; note: string }> {
  const db = env.DB;
  const sync = await db.prepare("SELECT id, url, playlist_id, course_id, title_prefix, title_format FROM youtube_syncs WHERE id = ?").bind(syncId).first<{ id: string; url: string; playlist_id: string; course_id: string; title_prefix: string; title_format: string }>();
  if (!sync) return { imported: 0, note: "找不到這個同步設定" };
  const finish = async (out: { imported: number; note: string }) => {
    await sortMaterialsByDate(db, sync.course_id); // 每次同步都把整張卡依日期排好（新到舊）
    await db.prepare("UPDATE youtube_syncs SET last_synced_at = ?, last_imported = ?, last_note = ? WHERE id = ?").bind(new Date().toISOString(), out.imported, out.note.slice(0, 600), syncId).run();
    return out;
  };
  if (!env.YOUTUBE_API_KEY) return finish({ imported: 0, note: "尚未設定 YouTube 金鑰" });
  const have = new Set((await db.prepare("SELECT media_ref FROM lessons WHERE course_id = ? AND media_ref IS NOT NULL").bind(sync.course_id).all<{ media_ref: string }>()).results.map((r) => r.media_ref));
  const read = await readPlaylist(env.YOUTUBE_API_KEY, sync.playlist_id, have);
  if ("error" in read) return finish({ imported: 0, note: read.error });
  if (!read.items.length) return finish({ imported: 0, note: "沒有新的影片（都已經同步過了）" });
  // 最新的在最上面（業主 2026-11-20）：新影片依日期由新到舊，加在這份清單所有教材的最前面。
  const items = [...read.items].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const pos = await nextPos(db, sync.course_id);
  const ids = items.map(() => `${sync.course_id}-${short()}`);
  const lines: string[] = [];
  // 名稱一樣的教材才加日期（業主 2026-11-20）：同一批裡、或和這張卡原本就有的教材同名，就在名稱後面加「（月/日）」。
  const base = items.map((it) => syncTitle(sync.title_format || defaultSyncFormat(sync.title_prefix), it.title, it.date).slice(0, 120) || it.title);
  const existing = new Set((await db.prepare("SELECT title FROM lessons WHERE course_id = ?").bind(sync.course_id).all<{ title: string }>()).results.map((r) => r.title));
  const count = new Map<string, number>();
  for (const n of base) count.set(n, (count.get(n) ?? 0) + 1);
  const names = base.map((n, i) => {
    if ((count.get(n) ?? 0) < 2 && !existing.has(n)) return n;
    const d = /^\d{4}-(\d{2})-(\d{2})/.exec(items[i]!.date ?? "");
    return d ? `${n}（${Number(d[1])}/${Number(d[2])}）` : n;
  });
  await db.batch(
    items.map((it, i) => {
      const name = names[i]!;
      lines.push(`${name}｜${it.title}`);
      return db.prepare("INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type, media_ref, event_date, kind) VALUES (?, ?, ?, ?, 0, 'youtube', ?, ?, 'material')").bind(ids[i]!, sync.course_id, pos + i, name, it.id, it.date);
    }),
  );
  await placeOnTop(db, sync.course_id, ids);
  return finish({ imported: items.length, note: lines.join("\n").slice(0, 600) });
}

/**
 * 依這份同步目前的命名規則，重新命名「已經匯入」的教材（業主 2026-11-20：改規則後，舊的也要跟著改）。
 * 重新讀播放清單取得影片標題與日期，只改名稱、不動其他欄位；同名時一樣加「（月/日）」。
 */
export async function renameYoutubeSync(env: Env, syncId: string): Promise<{ renamed: number; note: string }> {
  const db = env.DB;
  const sync = await db.prepare("SELECT playlist_id, course_id, title_prefix, title_format FROM youtube_syncs WHERE id = ?").bind(syncId).first<{ playlist_id: string; course_id: string; title_prefix: string; title_format: string }>();
  if (!sync) return { renamed: 0, note: "找不到這個同步設定" };
  if (!env.YOUTUBE_API_KEY) return { renamed: 0, note: "尚未設定 YouTube 金鑰" };
  const read = await readPlaylist(env.YOUTUBE_API_KEY, sync.playlist_id, new Set());
  if ("error" in read) return { renamed: 0, note: read.error };
  const rows = (await db.prepare("SELECT id, media_ref, title FROM lessons WHERE course_id = ? AND kind = 'material' AND media_type = 'youtube' AND media_ref IS NOT NULL").bind(sync.course_id).all<{ id: string; media_ref: string; title: string }>()).results;
  const byVideo = new Map(read.items.map((it) => [it.id, it]));
  const targets = rows.filter((r) => byVideo.has(r.media_ref));
  const fmt = sync.title_format || defaultSyncFormat(sync.title_prefix);
  const base = targets.map((r) => syncTitle(fmt, byVideo.get(r.media_ref)!.title, byVideo.get(r.media_ref)!.date).slice(0, 120) || r.title);
  const count = new Map<string, number>();
  for (const n of base) count.set(n, (count.get(n) ?? 0) + 1);
  const stmts = targets.flatMap((r, i) => {
    let name = base[i]!;
    if ((count.get(name) ?? 0) >= 2) {
      const d = /^\d{4}-(\d{2})-(\d{2})/.exec(byVideo.get(r.media_ref)!.date ?? "");
      if (d) name = `${name}（${Number(d[1])}/${Number(d[2])}）`;
    }
    return name === r.title ? [] : [db.prepare("UPDATE lessons SET title = ? WHERE id = ?").bind(name, r.id)];
  });
  if (stmts.length) await db.batch(stmts);
  await sortMaterialsByDate(db, sync.course_id);
  return { renamed: stmts.length, note: stmts.length ? `已重新命名 ${stmts.length} 個教材` : "名稱都已經符合命名規則" };
}

/** 排程：還沒同步過的同步設定，自動做第一次同步（之後都是手動按「同步」；每次最多 2 份）。 */
export async function processFirstSyncs(env: Env): Promise<number> {
  if (!env.YOUTUBE_API_KEY) return 0;
  const { results } = await env.DB.prepare("SELECT id FROM youtube_syncs WHERE last_synced_at IS NULL ORDER BY created_at LIMIT 2").all<{ id: string }>();
  for (const r of results) await runYoutubeSync(env, r.id);
  return results.length;
}
