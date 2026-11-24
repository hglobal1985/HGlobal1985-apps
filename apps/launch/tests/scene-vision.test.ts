import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { cleanScene, scenePending } from "../src/scene-vision.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("場景標籤整理：去編號、標點、重複，最多 12 個", () => {
  assert.equal(cleanScene("1. 室內，講師。\n- 白板、聽講 ,室內"), "室內，講師，白板，聽講");
  assert.equal(cleanScene("場景：教室，行為：上課"), "教室，上課");
  assert.equal(cleanScene("a,b,c,d,e,f,g,h,i,j,k,l,m,n").split("，").length, 12);
});

test("相簿照片場景辨識：只辨識區塊照片（不辨識封面與中心EDM），完成後有進度", async () => {
  const db = createTestDb();
  const store = new Map<string, Uint8Array>([["album/a/p1.jpg", new Uint8Array([0xff, 0xd8, 1, 2])], ["album/b/e1.jpg", new Uint8Array([0xff, 0xd8, 3])]]);
  const calls: string[] = [];
  const env: Env = {
    DB: db,
    DEMO_LOGIN: "on",
    MEDIA: { get: async (k: string) => { const v = store.get(k); return v ? { body: new Blob([v as BlobPart]).stream(), httpMetadata: { contentType: "image/jpeg" } } : null; }, put: async () => {}, head: async () => null, delete: async () => {}, list: async () => ({ objects: [], truncated: false }) } as unknown as Env["MEDIA"],
    AI: { run: async (model: string) => { calls.push(model); return { response: "1. 室內\n2. 講師，白板" }; } } as unknown as Env["AI"],
  };
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await run("INSERT INTO courses (id, title, is_list, status, series, view_scope, is_public) VALUES ('c1', '成交百寶箱', 0, 'published', '', 'all', 1)");
  await run("INSERT INTO lessons (id, course_id, position, title, kind, media_type) VALUES ('blk', 'c1', 1, '家庭清潔', 'section', 'demo')");
  await run("INSERT INTO cover_media (id, owner_kind, center_key, owner_key, kind, r2_key, position, scope) VALUES ('m1', 'course', NULL, 'blk', 'image', 'album/a/p1.jpg', 0, 'cover'), ('m2', 'center', '台北中心', '', 'image', 'album/b/e1.jpg', 0, 'edm'), ('m3', 'course', NULL, 'c1', 'image', 'album/b/e1.jpg', 0, 'cover')");
  await scenePending(env, db, 5);
  const rows = (await db.prepare("SELECT id, scene_status, scene_text FROM cover_media ORDER BY id").all<{ id: string; scene_status: string; scene_text: string }>()).results;
  assert.deepEqual(rows.map((r) => [r.id, r.scene_status]), [["m1", "done"], ["m2", ""], ["m3", ""]], "只辨識區塊照片");
  assert.equal(rows[0]!.scene_text, "室內，講師，白板");
  assert.equal(calls.length, 1);
  // 課程頁帶出場景標籤、設定頁進度
  const login = async () => ((await (await handleApi(new Request("https://learn.test/api/v2/auth/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sub: "demo-admin" }) }), env)).json()) as { token: string }).token;
  const token = await login();
  const prog = (await (await handleApi(new Request("https://learn.test/api/v2/admin/ai/progress", { headers: { authorization: `Bearer ${token}` } }), env)).json()) as { scene: { total: number; done: number; pending: number; groups: { label: string }[] }; ocr: { total: number; pending: number }; ai: { remaining: number } };
  assert.equal(prog.scene.total, 1);
  assert.equal(prog.scene.done, 1);
  assert.equal(prog.scene.groups[0]!.label, "成交百寶箱 › 家庭清潔");
  assert.equal(prog.ocr.total, 1);
  assert.equal(prog.ocr.pending, 1);
  assert.ok(prog.ai.remaining > 0);
});
