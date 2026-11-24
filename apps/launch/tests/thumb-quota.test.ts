import assert from "node:assert/strict";
import { test } from "node:test";
import { reserveThumb, thumbUsage } from "../src/thumb-quota.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("縮圖額度：封面 > 中心EDM > 其他相簿，預留額度制，重複的縮圖不重複計", async () => {
  const db = createTestDb();
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await run("INSERT INTO courses (id, title, is_list, status, series, view_scope, is_public) VALUES ('c1', '成交百寶箱', 0, 'published', '', 'all', 1)");
  await run("INSERT INTO lessons (id, course_id, position, title, kind, media_type) VALUES ('blk', 'c1', 1, '家庭清潔', 'section', 'demo')");
  await run("INSERT INTO cover_media (id, owner_kind, center_key, owner_key, kind, r2_key, position, scope) VALUES ('m1', 'center', '台北中心', '', 'image', 'album/a/e1.jpg', 0, 'edm'), ('m2', 'course', NULL, 'blk', 'image', 'album/b/p1.jpg', 0, 'cover'), ('m3', 'course', NULL, 'blk', 'image', 'album/b/p2.jpg', 1, 'cover'), ('m4', 'center', '台北中心', '', 'image', 'album/c/cv.jpg', 0, 'cover')");
  const q = { monthly: 10, edmPct: 50, albumPct: 20 }; // EDM 最多 5、相簿最多 2
  assert.equal(await reserveThumb(db, q, "album/b/p1.jpg", 320), true);
  assert.equal(await reserveThumb(db, q, "album/b/p1.jpg", 320), true, "同一張同一寬度不重複計");
  assert.equal(await reserveThumb(db, q, "album/b/p2.jpg", 320), true);
  assert.equal(await reserveThumb(db, q, "album/b/p1.jpg", 480), false, "相簿到上限（2）就不縮");
  assert.equal(await reserveThumb(db, q, "album/a/e1.jpg", 320), true, "EDM 還有額度");
  assert.equal(await reserveThumb(db, q, "album/c/cv.jpg", 320), true, "封面永遠優先");
  const u = await thumbUsage(db, q);
  assert.equal(u.used, 4);
  assert.equal(u.remaining, 6);
  assert.deepEqual(u.classes.map((c) => [c.cls, c.used, c.cap]), [["cover", 1, 10], ["edm", 1, 5], ["album", 2, 2]]);
  assert.ok(u.groups.some((g) => g.cls === "album" && g.label === "成交百寶箱 › 家庭清潔" && g.used === 2));
});
