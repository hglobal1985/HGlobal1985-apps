/**
 * 舊照片重新壓縮（杜杜龍 2026-11-25）：把「相簿」裡所有舊照片（cover_media 的圖片：中心 EDM、中心封面、系列／課程封面輪播、區塊相簿）
 * 依「設定 › 儲存空間管理 › 相簿照片」的格式與畫質重壓，覆蓋原檔（同一個 R2 檔名、換 Content-Type，所有引用不用改）。
 * ⚠ 不可復原：站內不保留原圖，覆蓋後只剩壓縮版。由超級管理員在設定頁按「開始」才會跑；排程每 10 分鐘在時間內分批同時處理，直到全部處理完或按「暫停」。
 * 已經是目標格式的跳過；再壓沒有變小的維持原樣；失敗的標記後不再重試。只處理 cover_media，不碰品牌 logo、課程單張 EDM／封面、課表。
 */
import type { D1Database, Env } from "./d1.ts";
import { shrinkImage } from "./image-store.ts";
import { loadConfig } from "./ui-config.ts";

const KEY = "recompress_job";
export type RecompressJob = { running: boolean; startedAt: string | null; stoppedAt: string | null };

export async function loadJob(db: D1Database): Promise<RecompressJob> {
  try {
    const row = await db.prepare("SELECT value FROM ui_settings WHERE key = ?").bind(KEY).first<{ value: string }>();
    const j = row ? (JSON.parse(row.value) as Partial<RecompressJob>) : {};
    return { running: j.running === true, startedAt: j.startedAt ?? null, stoppedAt: j.stoppedAt ?? null };
  } catch {
    return { running: false, startedAt: null, stoppedAt: null };
  }
}
export async function saveJob(db: D1Database, j: RecompressJob): Promise<void> {
  await db
    .prepare("INSERT INTO ui_settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(KEY, JSON.stringify(j))
    .run();
}

export async function recompressStatus(db: D1Database) {
  const r = await db
    .prepare("SELECT COUNT(*) AS total, SUM(recompress = '') AS pending, SUM(recompress = 'done') AS done, SUM(recompress = 'skip') AS skip, SUM(recompress = 'fail') AS fail, COALESCE(SUM(bytes), 0) AS bytes, COALESCE(SUM(CASE WHEN recompress = 'done' THEN bytes_before - bytes ELSE 0 END), 0) AS saved FROM cover_media WHERE kind = 'image'")
    .first<{ total: number; pending: number | null; done: number | null; skip: number | null; fail: number | null; bytes: number; saved: number }>();
  const app = (await loadConfig(db)).app;
  return { job: await loadJob(db), total: r?.total ?? 0, pending: r?.pending ?? 0, done: r?.done ?? 0, skip: r?.skip ?? 0, fail: r?.fail ?? 0, bytes: r?.bytes ?? 0, saved: r?.saved ?? 0, target: { format: app.albumFormat, quality: app.albumQuality } };
}

async function one(env: Env, db: D1Database, id: string, target: { format: "jpeg" | "webp" | "avif"; quality: number }): Promise<void> {
  const row = await db.prepare("SELECT r2_key, bytes FROM cover_media WHERE id = ? AND kind = 'image' AND recompress = ''").bind(id).first<{ r2_key: string; bytes: number }>();
  if (!row || !env.MEDIA) return;
  const mark = (v: string, extra = "") => db.prepare(`UPDATE cover_media SET recompress = ?${extra} WHERE id = ?`);
  try {
    const obj = await env.MEDIA.get(row.r2_key);
    if (!obj) return void (await mark("fail").bind("fail", id).run());
    const type = obj.httpMetadata?.contentType ?? "image/jpeg";
    const before = row.bytes || obj.size;
    // 已經是目標格式（例如之後新上傳的）：不再壓第二次
    if (type === `image/${target.format}`) return void (await mark("skip").bind("skip", id).run());
    const data = await new Response(obj.body).arrayBuffer();
    const shrunk = await shrinkImage(env, data, type, "center", false, target);
    if (shrunk.type === type && shrunk.size >= data.byteLength) return void (await mark("skip").bind("skip", id).run());
    if (shrunk.type !== `image/${target.format}`) return void (await mark("fail").bind("fail", id).run()); // 轉檔沒成功（沒有圖片轉檔服務）
    await env.MEDIA.put(row.r2_key, shrunk.data, { httpMetadata: { contentType: shrunk.type } });
    await db.prepare("UPDATE cover_media SET recompress = 'done', bytes_before = ?, bytes = ? WHERE id = ?").bind(before, shrunk.size, id).run();
  } catch (e) {
    console.log("recompress_failed", id, e instanceof Error ? e.message : String(e));
    await db.prepare("UPDATE cover_media SET recompress = 'fail' WHERE id = ?").bind(id).run().catch(() => undefined);
  }
}

/** 排程呼叫：任務在執行中就分批處理；沒有待處理的就標記完成。budgetSec＝這次最多跑幾秒。 */
export async function runRecompress(env: Env, db: D1Database, budgetSec = 240): Promise<{ done: number; finished: boolean }> {
  const job = await loadJob(db);
  if (!job.running || !env.MEDIA || !env.IMAGES) return { done: 0, finished: false };
  const app = (await loadConfig(db)).app;
  const target = { format: app.albumFormat, quality: app.albumQuality };
  const until = Date.now() + budgetSec * 1000;
  let done = 0;
  while (Date.now() < until) {
    const { results } = await db.prepare("SELECT id FROM cover_media WHERE kind = 'image' AND recompress = '' ORDER BY created_at DESC LIMIT 12").all<{ id: string }>();
    if (!results.length) {
      await saveJob(db, { running: false, startedAt: job.startedAt, stoppedAt: new Date().toISOString() });
      return { done, finished: true };
    }
    const queue = results.map((r) => r.id);
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (queue.length && Date.now() < until) await one(env, db, queue.shift()!, target);
      }),
    );
    done += results.length;
    if (!(await loadJob(db)).running) break; // 中途按了暫停
  }
  return { done, finished: false };
}
