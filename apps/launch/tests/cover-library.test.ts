import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env, R2Bucket } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

function memR2() {
  const store = new Map<string, Uint8Array>();
  const bucket = {
    store,
    async head(k: string) {
      return store.has(k) ? { size: store.get(k)!.byteLength } : null;
    },
    async get(k: string) {
      const d = store.get(k);
      return d ? { size: d.byteLength, httpMetadata: { contentType: "image/jpeg" }, body: new Response(d as Uint8Array<ArrayBuffer>).body! } : null;
    },
    async delete(k: string) {
      store.delete(k);
    },
    async list(opts?: { prefix?: string }) {
      return { objects: [...store].filter(([k]) => !opts?.prefix || k.startsWith(opts.prefix)).map(([key, d]) => ({ key, size: d.byteLength, uploaded: new Date("2026-11-19T00:00:00Z") })), truncated: false };
    },
    async put(k: string, v: ArrayBuffer) {
      store.set(k, new Uint8Array(v));
    },
  };
  return bucket as unknown as R2Bucket & { store: Map<string, Uint8Array> };
}

test("封面庫：列出未使用與使用中的封面、預覽、永久刪除（使用中的不能刪、只有超級管理員）", async () => {
  const db = createTestDb();
  const r2 = memR2();
  const env = { DB: db, DEMO_LOGIN: "on", MEDIA: r2 } as Env;
  const call = async (method: string, path: string, token?: string) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} }), env);
    return res;
  };
  const login = async (sub: string) => ((await (await handleApi(new Request("https://learn.test/api/v2/auth/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sub }) }), env)).json()) as { token: string }).token;
  const admin = await login("demo-admin");
  const student = await login("demo-student");

  // 使用中：一門課的 EDM／封面、一個系列的封面、一份清單的 EDM
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  for (const k of ["edm/c1/a.jpg", "cover/c1/b.jpg", "series/s1/cover-c.jpg", "edm/l1/d.jpg", "edm/c1/old-unused.jpg", "series/s1/orphan.png", "lesson/x/orphan2.webp", "file/c1/not-a-cover.pdf", "brand/b1/logo.png"]) await r2.put(k, bytes);
  await db.prepare("INSERT INTO courses (id, title, status, series, edm_key, cover_key) VALUES ('c1', '課程一', 'published', '系列甲', 'edm/c1/a.jpg', 'cover/c1/b.jpg')").run();
  await db.prepare("INSERT INTO courses (id, title, status, is_list, edm_key) VALUES ('l1', '清單一', 'published', 1, 'edm/l1/d.jpg')").run();
  await db.prepare("INSERT INTO series_art (series, edm_key, cover_key) VALUES ('系列甲', 'series/s1/x.jpg', 'series/s1/cover-c.jpg')").run();

  assert.equal((await call("GET", "/admin/cover-library", student)).status, 403);
  const lib = (await (await call("GET", "/admin/cover-library", admin)).json()) as { unused: { key: string; label: string }[]; series: { id: string }[]; courses: { id: string; coverUrl: string | null }[]; lists: { id: string }[] };
  assert.deepEqual(lib.unused.map((x) => x.key).sort(), ["edm/c1/old-unused.jpg", "lesson/x/orphan2.webp", "series/s1/orphan.png"]);
  assert.deepEqual([lib.series.map((x) => x.id), lib.courses.map((x) => x.id), lib.lists.map((x) => x.id)], [["系列甲"], ["c1"], ["l1"]]);
  assert.ok(lib.courses[0]!.coverUrl?.includes("cover%2Fc1%2Fb.jpg"));

  // 預覽：未使用的檔案超級管理員看得到、學員不行
  assert.equal((await call("GET", `/admin/cover-library/file?k=${encodeURIComponent("series/s1/orphan.png")}`, admin)).status, 200);
  assert.equal((await call("GET", `/admin/cover-library/file?k=${encodeURIComponent("series/s1/orphan.png")}`, student)).status, 403);
  // 刪除：使用中不准、只有超級管理員、不是封面資料夾的檔案不准
  assert.equal((await call("DELETE", `/admin/cover-library?k=${encodeURIComponent("edm/c1/a.jpg")}`, admin)).status, 409);
  assert.equal((await call("DELETE", `/admin/cover-library?k=${encodeURIComponent("series/s1/orphan.png")}`, student)).status, 403);
  assert.equal((await call("DELETE", `/admin/cover-library?k=${encodeURIComponent("file/c1/not-a-cover.pdf")}`, admin)).status, 400);
  assert.equal((await call("DELETE", `/admin/cover-library?k=${encodeURIComponent("series/s1/orphan.png")}`, admin)).status, 200);
  assert.equal(r2.store.has("series/s1/orphan.png"), false, "R2 上的檔案真的被刪掉");
  assert.equal(r2.store.has("edm/c1/a.jpg"), true, "使用中的檔案還在");
  assert.equal(r2.store.has("file/c1/not-a-cover.pdf"), true);
});
