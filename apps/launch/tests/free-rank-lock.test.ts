import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("免費課程後來才加獎銜限制：先前自動報名的不符合者，章節鎖住、不能播放", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const tok = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const admin = await tok("demo-admin");
  const student = await tok("demo-student");
  const c = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "免費課", teacher: "王", status: "published", priceTwd: 0 } })).data;
  await call("POST", `/admin/courses/${c.id}/lessons`, { token: admin, body: { title: "第一堂", mediaType: "youtube", mediaRef: "dQw4w9WgXcQ" } });
  const open = (await call<CourseDetail>("GET", `/courses/${c.id}`, { token: student })).data; // 開啟＝自動免費報名
  assert.equal(open.enrollment, "opened");
  assert.ok(open.lessons.some((l) => !l.locked));
  await call("PATCH", `/admin/courses/${c.id}`, { token: admin, body: { minRankCode: "crown" } });
  const after = (await call<CourseDetail>("GET", `/courses/${c.id}`, { token: student })).data;
  assert.ok(after.lessons.length > 0 && after.lessons.every((l) => l.locked), "加上獎銜限制後，不符合者章節要鎖住");
});

test("免費課程後來把「誰能瀏覽」改嚴：先前自動報名的不在範圍內者，看不到課程也不能播放；付費課程已報名者照常", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const tok = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const admin = await tok("demo-admin");
  const student = await tok("demo-outsider");
  const c = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "免費課", teacher: "王", status: "published", priceTwd: 0 } })).data;
  await call("POST", `/admin/courses/${c.id}/lessons`, { token: admin, body: { title: "第一堂" } });
  assert.equal((await call<CourseDetail>("GET", `/courses/${c.id}`, { token: student })).data.enrollment, "opened");
  await call("PATCH", `/admin/courses/${c.id}`, { token: admin, body: { viewScope: "hglobal" } });
  assert.equal((await call("GET", `/courses/${c.id}`, { token: student })).status, 404, "免費課改成寰宇夥伴後，不在範圍內的人看不到");
  const list = (await call<{ id: string }[]>("GET", "/courses", { token: student })).data;
  assert.ok(!list.some((x) => x.id === c.id), "清單也不出現");
});
