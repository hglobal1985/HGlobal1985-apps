import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail, CourseSummary } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("清單的區塊：顯示在上拉選單、品牌、分類；沒上傳封面用品牌 logo；底下的素材數", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const admin = (await call<{ token: string }>("POST", "/auth/demo", { body: { sub: "demo-admin" } })).data.token;
  const { id: brand } = (await call<{ id: string }>("POST", "/admin/brand-logos", { token: admin, body: { name: "雅姿" } })).data;
  await db.prepare("UPDATE brand_logos SET logo_key = 'brand/x/a.png' WHERE id = ?").bind(brand).run();
  const c = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { isList: true, title: "新品上市培訓", series: "新品上市培訓" } })).data;
  assert.deepEqual(c.blocks ?? [], []);
  const add = (body: unknown) => call<CourseDetail>("POST", `/admin/courses/${c.id}/lessons`, { token: admin, body });
  await add({ kind: "section", title: "雅姿", brandId: brand, categories: ["美容", "產品"] });
  await add({ kind: "section", title: "隱藏區塊", inSheet: false });
  assert.equal((await add({ kind: "section", title: "壞品牌", brandId: "nope" })).status, 400);
  const list = async () => (await call<CourseSummary[]>("GET", "/courses", { token: admin })).data.find((x) => x.id === c.id)!;
  const sum = await list();
  assert.equal(sum.blocks.length, 1, "只列勾了顯示在上拉選單的區塊");
  const b = sum.blocks[0]!;
  assert.deepEqual([b.title, b.brandId, b.categories, b.count], ["雅姿", brand, "美容、產品", 0]);
  assert.ok(b.brand, "沒上傳封面用品牌 logo");
  // 區塊底下的素材（有影片來源）會算進數量；不勾選的區塊不列
  const d = (await call<CourseDetail>("GET", `/courses/${c.id}`, { token: admin })).data;
  const sectionId = d.lessons.find((l) => l.section && l.title === "雅姿")!.id;
  assert.equal(d.lessons.find((l) => l.id === sectionId)!.inSheet, true);
  await call("PATCH", `/admin/lessons/${sectionId}`, { token: admin, body: { inSheet: false } });
  assert.equal((await list()).blocks.length, 0);
  // 預設勾選
  const d2 = (await add({ kind: "section", title: "預設" })).data;
  assert.equal(d2.lessons.find((l) => l.title === "預設")!.inSheet, true);
  // 課程類別沒有區塊
  const normal = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "一般課", teacher: "王", status: "published" } })).data;
  assert.deepEqual(normal.blocks, []);
});
