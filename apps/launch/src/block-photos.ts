import type { D1Database, Env } from "./d1.ts";

/**
 * 區塊照片（杜杜龍 2026-11-24）：開放區塊照片的課程（courses.block_photos = 1），區塊裡「以教材檔案上傳的圖片」自動搬進相簿——
 * 檔案複製到相簿專用位置（album/…，網頁才讀得到）、照片依原本順序排進該區塊的相簿，原本的教材列移除。可重複執行；每次最多處理 60 個；打開開放區塊照片的課程頁時也會立刻觸發（`kickFilePhotos`，同一個程序一分鐘最多一次）。
 */
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export async function migrateFilePhotos(env: Env): Promise<number> {
  const db: D1Database = env.DB;
  const bucket = env.MEDIA;
  if (!bucket) return 0;
  const { results } = await db
    .prepare(
      `SELECT l.id AS lesson_id, l.course_id, a.id AS att_id, a.r2_key, a.content_type, a.size,
              (SELECT s.id FROM lessons s WHERE s.course_id = l.course_id AND s.kind = 'section' AND s.position < l.position ORDER BY s.position DESC LIMIT 1) AS block_id
       FROM lessons l
       JOIN courses c ON c.id = l.course_id AND c.block_photos = 1
       JOIN lesson_attachments a ON a.lesson_id = l.id AND a.kind = 'file' AND a.content_type LIKE 'image/%'
       WHERE l.kind = 'material' AND l.is_full = 0
         AND (SELECT COUNT(*) FROM lesson_attachments x WHERE x.lesson_id = l.id) = 1
       ORDER BY l.course_id, l.position LIMIT 60`,
    )
    .all<{ lesson_id: string; course_id: string; att_id: string; r2_key: string | null; content_type: string; size: number; block_id: string | null }>();
  let done = 0;
  for (const r of results) {
    if (!r.r2_key || !r.block_id) continue; // 不在任何區塊裡的圖片教材不動
    // 先「認領」：刪掉附件列，只有一個執行者會刪成功（排程和打開頁面可能同時在跑，避免同一張搬兩次）。
    const claim = await db.prepare("DELETE FROM lesson_attachments WHERE id = ?").bind(r.att_id).run();
    if (!claim.meta?.changes) continue;
    const restore = () => db.prepare("INSERT OR IGNORE INTO lesson_attachments (id, lesson_id, course_id, name, r2_key, size, content_type, kind, created_by) VALUES (?, ?, ?, '圖片', ?, ?, ?, 'file', 'migration')").bind(r.att_id, r.lesson_id, r.course_id, r.r2_key, r.size, r.content_type).run();
    const obj = await bucket.get(r.r2_key).catch(() => null);
    if (!obj) {
      await restore();
      continue;
    }
    const bytes = await new Response(obj.body).arrayBuffer();
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const key = `album/${id}/${crypto.randomUUID()}.${EXT[r.content_type] ?? "jpg"}`;
    await bucket.put(key, bytes, { httpMetadata: { contentType: r.content_type } });
    const pos = ((await db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM cover_media WHERE owner_kind = 'course' AND owner_key = ? AND scope = 'cover'").bind(r.block_id).first<{ p: number }>())?.p ?? 0);
    await db.batch([
      db.prepare("INSERT INTO cover_media (id, owner_kind, center_key, owner_key, kind, r2_key, width, height, bytes, position, created_by, scope) VALUES (?, 'course', NULL, ?, 'image', ?, 0, 0, ?, ?, 'migration', 'cover')").bind(id, r.block_id, key, r.size, pos),
      db.prepare("DELETE FROM lessons WHERE id = ?").bind(r.lesson_id),
    ]).catch(async (e) => {
      await restore();
      throw e;
    });
    await bucket.delete(r.r2_key).catch(() => undefined);
    done++;
  }
  return done;
}

let lastKick = 0;
/** 打開開放區塊照片的課程頁時，背景立刻搬一次（不用等排程）。 */
export function kickFilePhotos(env: Env, defer: (p: Promise<unknown>) => void): void {
  const now = Date.now();
  if (now - lastKick < 60_000) return;
  lastKick = now;
  defer(migrateFilePhotos(env).catch(() => undefined));
}
