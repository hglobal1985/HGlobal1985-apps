import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureBrandCards } from "../src/brand-cards.ts";
import type { CourseDetail } from "../src/contract.ts";
import { ensureTreasureLinks } from "../src/treasure-box.ts";
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
