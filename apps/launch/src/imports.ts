import { classifyLink } from "./links.ts";
import type { D1Database, Env } from "./d1.ts";
import { loadConfig } from "./ui-config.ts";
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

const nextPos = async (db: D1Database, courseId: string) => ((await db.prepare("SELECT COALESCE(MAX(position), 0) AS m FROM lessons WHERE course_id = ?").bind(courseId).first<{ m: number }>())?.m ?? 0) + 1;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

async function fetchImage(url: string, side: number): Promise<{ data: ArrayBuffer; type: string } | null> {
  const u = url.replace(/=w\d+(?=$|[-&])/, `=w${side}`);
  const res = await fetch(u, { headers: { accept: "image/*" } }).catch(() => null);
  const type = (res?.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (!res?.ok || !EXT[type]) return null;
  const data = await res.arrayBuffer();
  return data.byteLength > 0 && data.byteLength <= 8 * 1024 * 1024 ? { data, type } : null;
}

async function runJob(env: Env, job: Job, key: string | undefined, side: number): Promise<{ imported: number; note: string }> {
  const db = env.DB;
  if (job.kind === "playlist") {
    if (!key) return { imported: 0, note: "尚未設定 YouTube 金鑰" };
    const have = new Set((await db.prepare("SELECT media_ref FROM lessons WHERE course_id = ? AND media_ref IS NOT NULL").bind(job.course_id).all<{ media_ref: string }>()).results.map((r) => r.media_ref));
    const items: { id: string; title: string; date: string | null }[] = [];
    let token = "";
    for (let page = 0; page < 6; page++) {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${encodeURIComponent(job.url)}&key=${encodeURIComponent(key)}${token ? `&pageToken=${token}` : ""}`, { headers: { accept: "application/json" } }).catch(() => null);
      if (!res?.ok) return { imported: 0, note: `讀取播放清單失敗（${res?.status ?? "連線錯誤"}）` };
      const data = (await res.json()) as { items?: { snippet?: { title?: string }; contentDetails?: { videoId?: string; videoPublishedAt?: string } }[]; nextPageToken?: string };
      for (const it of data.items ?? []) {
        const id = it.contentDetails?.videoId;
        const title = it.snippet?.title ?? "";
        if (!id || /^(private video|deleted video)$/i.test(title) || have.has(id)) continue;
        have.add(id);
        items.push({ id, title: title.slice(0, 120), date: taipeiDay(it.contentDetails?.videoPublishedAt) });
      }
      if (!data.nextPageToken) break;
      token = data.nextPageToken;
    }
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
  const img = await fetchImage(job.url, side);
  if (!img) return { imported: 0, note: "圖片下載失敗" };
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
