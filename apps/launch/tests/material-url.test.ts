import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("素材第二層短網址：/系列縮寫/素材名稱，只有超級管理員能設、同系列不可重複、改名後舊網址有效、分享網址用它", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const admin = (await call<{ token: string }>("POST", "/auth/demo", { body: { sub: "demo-admin" } })).data.token;
  await db.prepare("INSERT INTO short_links (slug, kind, value) VALUES ('Beauty-Starry', 'series', '美力之星')").run();
  const a = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "第一屆", isList: true, status: "published", series: "美力之星" } })).data;
  const b = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "第二屆", isList: true, status: "published", series: "美力之星" } })).data;
  // 格式與保留字
  assert.equal((await call("PATCH", `/admin/courses/${a.id}`, { token: admin, body: { matUrl: "中文" } })).status, 400);
  assert.equal((await call("PATCH", `/admin/courses/${a.id}`, { token: admin, body: { matUrl: "edit" } })).status, 400);
  const set = (await call<CourseDetail>("PATCH", `/admin/courses/${a.id}`, { token: admin, body: { matUrl: "2027-Final" } })).data;
  assert.equal(set.matUrl, "2027-final", "自動小寫");
  assert.equal(set.shortPath, "Beauty-Starry/2027-final");
  // 同系列不可重複
  assert.equal((await call("PATCH", `/admin/courses/${b.id}`, { token: admin, body: { matUrl: "2027-FINAL" } })).status, 400);
  // 解析
  assert.deepEqual((await call("GET", "/short-links/beauty-starry/2027-final")).data, { courseId: a.id });
  // 改名：舊網址永遠有效，也不能被別份素材搶走
  await call("PATCH", `/admin/courses/${a.id}`, { token: admin, body: { matUrl: "2027-gala" } });
  assert.deepEqual((await call("GET", "/short-links/Beauty-Starry/2027-final")).data, { courseId: a.id });
  assert.equal((await call("PATCH", `/admin/courses/${b.id}`, { token: admin, body: { matUrl: "2027-final" } })).status, 400);
  assert.equal((await call("GET", "/short-links/Beauty-Starry/not-exist")).status, 404);
  // 一般小編不能設定
  const student = (await call<{ token: string }>("POST", "/auth/demo", { body: { sub: "demo-student" } })).data.token;
  assert.equal((await call("PATCH", `/admin/courses/${a.id}`, { token: student, body: { matUrl: "x1" } })).status, 403);
});
