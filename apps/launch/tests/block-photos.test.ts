import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureBrandCards } from "../src/brand-cards.ts";
import type { CourseDetail } from "../src/contract.ts";
import { ensureTreasureLinks } from "../src/treasure-box.ts";
import { migrateFilePhotos } from "../src/block-photos.ts";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

// 業主 2026-11-21：封面輪播與相簿（照片、短影音）。
type R2Bucket = NonNullable<Env["MEDIA"]>;
function memR2(): R2Bucket {
  const m = new Map<string, { body: Uint8Array; httpMetadata?: { contentType?: string } }>();
  return {
    put: async (k: string, v: ArrayBuffer | Uint8Array, o?: { httpMetadata?: { contentType?: string } }) => void m.set(k, { body: new Uint8Array(v as ArrayBuffer), httpMetadata: o?.httpMetadata }),
    get: async (k: string, o?: { range?: { offset: number; length: number } }) => {
      const x = m.get(k);
      if (!x) return null;
      const b = o?.range ? x.body.slice(o.range.offset, o.range.offset + o.range.length) : x.body;
      return { ...x, body: new Response(b as unknown as BodyInit).body };
    },
    head: async (k: string) => (m.has(k) ? { size: m.get(k)!.body.byteLength, httpMetadata: m.get(k)!.httpMetadata } : null),
    delete: async (k: string) => void m.delete(k),
    list: async () => ({ objects: [...m.keys()].map((key) => ({ key, size: 1 })), truncated: false }),
    _keys: () => [...m.keys()],
  } as unknown as R2Bucket;
}
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 50 }, (_, i) => i)]);
const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, ...Array.from({ length: 40 }, (_, i) => i)]);


test("區塊新增照片：只有開放的課程可以、照片屬於區塊、連結區塊（品牌卡）看到同一批", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on", MEDIA: memR2() };
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await run("INSERT INTO brand_logos (id, name, sort_order) VALUES ('ba', '紐崔萊', 1)");
  await run("INSERT INTO courses (id, title, is_list, status, series, view_scope, is_public, zone) VALUES ('cqqxw4z2', '成交百寶箱', 0, 'published', '成交百寶箱', 'all', 1, 'hglobal'), ('cother', '別的課', 0, 'published', '', 'all', 1, 'hglobal')");
  await run("UPDATE courses SET block_photos = 1 WHERE id = 'cqqxw4z2'");
  await run("INSERT INTO lessons (id, course_id, position, title, kind, media_type) VALUES ('osec', 'cother', 1, '別的區塊', 'section', 'demo')");
  await ensureBrandCards(env);
  await ensureTreasureLinks(env);
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; bytes?: Uint8Array } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.bytes as BodyInit | undefined }), env);
    const text = await res.text();
    return { status: res.status, data: (text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text) as T };
  };
  const login = async (sub: string) => {
    const res = await handleApi(new Request("https://learn.test/api/v2/auth/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sub }) }), env);
    return ((await res.json()) as { token: string }).token;
  };
  const [adm, stu] = await Promise.all([login("demo-admin"), login("demo-student")]);
  const blk = (await db.prepare("SELECT id FROM lessons WHERE course_id = 'cqqxw4z2' AND brand_id = 'ba'").first<{ id: string }>())!.id;
  // 沒開放的課程：擋下
  assert.equal((await call("PUT", `/admin/cover-media?kind=course&key=osec&w=100&h=100`, { token: adm, bytes: jpeg })).status, 403);
  // 一般會員：擋下
  assert.equal((await call("PUT", `/admin/cover-media?kind=course&key=${blk}&w=100&h=100`, { token: stu, bytes: jpeg })).status, 403);
  // 開放的課程：上傳成功
  const up = await call<{ items: { id: string }[] }>("PUT", `/admin/cover-media?kind=course&key=${blk}&w=1200&h=800`, { token: adm, bytes: jpeg });
  assert.equal(up.status, 200);
  assert.equal(up.data.items.length, 1);
  // 課程頁：該區塊帶出照片，另一個區塊（沒有）是空的
  const course = (await call<CourseDetail>("GET", "/courses/cqqxw4z2", { token: adm })).data;
  const head = course.lessons.find((l) => l.id === blk)!;
  assert.equal(head.photoKey, blk);
  assert.equal(head.photos?.length, 1);
  assert.equal(course.blockPhotos, true);
  // 照片也算教材數（業主 2026-11-24）：上拉選單的區塊數字、卡片的教材數量都含照片
  const list = (await call<{ id: string; materialCount: number; hasMaterial: boolean; blocks: { id: string; count: number }[] }[]>("GET", "/courses", { token: adm })).data;
  const box = list.find((c) => c.id === "cqqxw4z2")!;
  assert.equal(box.blocks.find((b) => b.id === blk)!.count, 1, "區塊數字含照片");
  assert.equal(box.materialCount, 1, "卡片教材數含照片");
  assert.equal(box.hasMaterial, true);
  assert.equal(list.find((c) => c.id === "cbba")!.materialCount, 1, "品牌卡的教材數含連結區塊裡的照片");
  // 品牌卡的「成交百寶箱」連結區塊：看到同一批照片（照片只存來源一份）
  const card = (await call<CourseDetail>("GET", "/courses/cbba", { token: adm })).data;
  const link = card.lessons[0]!;
  assert.equal(link.title, "成交百寶箱");
  assert.equal(link.photoKey, blk);
  assert.equal(link.photos?.length, 1);
  // 沒開放的課程不帶照片欄位
  assert.equal((await call<CourseDetail>("GET", "/courses/cother", { token: adm })).data.lessons[0]!.photoKey, undefined);
  // 刪除：兩邊都沒了
  const id = head.photos![0]!.id;
  assert.equal((await call("DELETE", `/admin/cover-media/${id}`, { token: adm })).status, 200);
  assert.equal((await call<CourseDetail>("GET", "/courses/cbba", { token: adm })).data.lessons[0]!.photos?.length, 0);
});

test("區塊裡以教材檔案上傳的圖片：自動搬進相簿（保持順序、舊檔移除、非圖片不動）", async () => {
  const db = createTestDb();
  const bucket = memR2();
  const env: Env = { DB: db, DEMO_LOGIN: "on", MEDIA: bucket };
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await run("INSERT INTO courses (id, title, is_list, status, series, view_scope, is_public, zone, block_photos) VALUES ('cbox', '成交百寶箱', 0, 'published', '', 'all', 1, 'hglobal', 1), ('cno', '沒開放', 0, 'published', '', 'all', 1, 'hglobal', 0)");
  await run("INSERT INTO lessons (id, course_id, position, title, kind, media_type) VALUES ('sec1', 'cbox', 1, '家庭清潔', 'section', 'demo'), ('i1', 'cbox', 2, '照片一', 'material', 'demo'), ('i2', 'cbox', 3, '照片二', 'material', 'demo'), ('f1', 'cbox', 4, '講義', 'material', 'demo'), ('n1', 'cno', 1, '別課照片', 'material', 'demo')");
  await bucket.put("file/cbox/a/one.jpg", jpeg.buffer as ArrayBuffer, { httpMetadata: { contentType: "image/jpeg" } });
  await bucket.put("file/cbox/b/two.jpg", jpeg.buffer as ArrayBuffer, { httpMetadata: { contentType: "image/jpeg" } });
  await bucket.put("file/cbox/c/doc.pdf", jpeg.buffer as ArrayBuffer, { httpMetadata: { contentType: "application/pdf" } });
  await bucket.put("file/cno/d/x.jpg", jpeg.buffer as ArrayBuffer, { httpMetadata: { contentType: "image/jpeg" } });
  const att = (id: string, lesson: string, course: string, key: string, type: string) => run("INSERT INTO lesson_attachments (id, lesson_id, course_id, name, r2_key, size, content_type, kind, created_by) VALUES (?, ?, ?, 'x', ?, 10, ?, 'file', 'u')", id, lesson, course, key, type);
  await att("a1", "i1", "cbox", "file/cbox/a/one.jpg", "image/jpeg");
  await att("a2", "i2", "cbox", "file/cbox/b/two.jpg", "image/jpeg");
  await att("a3", "f1", "cbox", "file/cbox/c/doc.pdf", "application/pdf");
  await att("a4", "n1", "cno", "file/cno/d/x.jpg", "image/jpeg");
  assert.equal(await migrateFilePhotos(env), 2);
  assert.equal(await migrateFilePhotos(env), 0, "可重複執行");
  const photos = (await db.prepare("SELECT r2_key FROM cover_media WHERE owner_kind = 'course' AND owner_key = 'sec1' ORDER BY position").all<{ r2_key: string }>()).results;
  assert.equal(photos.length, 2);
  assert.ok(photos.every((p) => p.r2_key.startsWith("album/")));
  assert.ok(await bucket.head(photos[0]!.r2_key));
  assert.equal(await bucket.head("file/cbox/a/one.jpg"), null, "舊檔移除");
  assert.ok(await bucket.head("file/cbox/c/doc.pdf"), "非圖片不動");
  assert.ok(await bucket.head("file/cno/d/x.jpg"), "沒開放的課程不動");
  assert.deepEqual((await db.prepare("SELECT id FROM lessons WHERE course_id = 'cbox' ORDER BY position").all<{ id: string }>()).results.map((r) => r.id), ["sec1", "f1"]);
});

test("成交百寶箱的報名資格（12% 以上、會長也可、不用報名）：連結區塊與照片一律照最新設定鎖住", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on", MEDIA: memR2() };
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await run("INSERT INTO brand_logos (id, name, sort_order) VALUES ('ba', '紐崔萊', 1)");
  await run("INSERT INTO courses (id, title, is_list, status, series, view_scope, is_public, zone, block_photos, min_rank_code, allow_president) VALUES ('cqqxw4z2', '成交百寶箱', 0, 'published', '成交百寶箱', 'all', 0, 'hglobal', 1, 'r12', 1)");
  await ensureBrandCards(env);
  await ensureTreasureLinks(env);
  const blk = (await db.prepare("SELECT id FROM lessons WHERE course_id = 'cqqxw4z2' AND brand_id = 'ba'").first<{ id: string }>())!.id;
  await run("INSERT INTO lessons (id, course_id, position, title, kind, media_type, media_ref) VALUES ('t1', 'cqqxw4z2', 100, '百寶箱影片', 'material', 'youtube', 'AAAAAAAAAAA')");
  await run("INSERT INTO cover_media (id, owner_kind, center_key, owner_key, kind, r2_key, position, scope) VALUES ('ph1', 'course', NULL, ?, 'image', 'album/a/p.jpg', 0, 'cover')", blk);
  const get = async (path: string, token?: string) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), env);
    return { status: res.status, data: (await res.json()) as CourseDetail & unknown[] };
  };
  // 訪客：品牌卡的成交百寶箱區塊鎖住，教材 locked、沒有網址，照片被藏起來但張數照給
  const guest = (await get("/courses/cbba")).data as CourseDetail;
  const head = guest.lessons[0]!;
  assert.equal(head.title, "成交百寶箱");
  assert.equal(head.blockLocked, true);
  assert.deepEqual(head.lockLines, ["登入並符合獎銜才能使用", "限12%獎銜以上使用（會長也可）"]);
  assert.equal(head.photos?.length, 1, "沒有權限的人也看得到預覽縮圖（畫面蓋鎖頭遮罩）");
  assert.equal(head.photoCount, 1);
  assert.equal(guest.lessons.find((l) => l.id === "t1")?.locked, true);
  assert.equal((await get(`/cover-media?kind=course&key=${blk}`)).data.length, 1);
  // 管理員：不受限
  const login = async (sub: string) => ((await (await handleApi(new Request("https://learn.test/api/v2/auth/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sub }) }), env)).json()) as { token: string }).token;
  const adm = await login("demo-admin");
  const adminView = (await get("/courses/cbba", adm)).data as CourseDetail;
  assert.equal(adminView.lessons[0]!.blockLocked, undefined);
  assert.equal(adminView.lessons[0]!.photos?.length, 1);
  assert.equal((await get(`/cover-media?kind=course&key=${blk}`, adm)).data.length, 1);
  // 把門檻改成「不限」：登入的會員立刻就能看（以最新設定為準；訪客仍要先登入，跟課程頁一樣）
  await run("UPDATE courses SET min_rank_code = 'none' WHERE id = 'cqqxw4z2'");
  const stu = await login("demo-student");
  const open = (await get("/courses/cbba", stu)).data as CourseDetail;
  assert.equal(open.lessons[0]!.blockLocked, undefined);
  assert.equal(open.lessons[0]!.photos?.length, 1);
  assert.equal((await get(`/cover-media?kind=course&key=${blk}`, stu)).data.length, 1);
  assert.equal(((await get("/courses/cbba")).data as CourseDetail).lessons[0]!.blockLocked, true, "訪客仍要登入");
});
