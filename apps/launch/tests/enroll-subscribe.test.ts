import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("課程類手動報名＝訂閱：新章節、時間地點更新都通知已報名者；清單類不能報名", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const tok = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const admin = await tok("demo-admin");
  const a = await tok("demo-student");
  const b = await tok("demo-silver");
  const c = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "訂閱課", teacher: "王", status: "published", priceTwd: 0 } })).data;
  await call("POST", "/orders", { token: a, body: { courseIds: [c.id] } });
  await call("POST", `/admin/courses/${c.id}/lessons`, { token: admin, body: { title: "新的一堂" } });
  const titles = async (t: string) => (await call<{ title: string }[]>("GET", "/notifications", { token: t })).data.map((n) => n.title);
  assert.ok((await titles(a)).some((t) => t.includes("有新章節")), "已報名者收到新章節通知");
  assert.ok(!(await titles(b)).some((t) => t.includes("有新章節")), "沒報名的人不通知");
  await call("PATCH", `/admin/courses/${c.id}`, { token: admin, body: { location: "新地點" } });
  assert.ok((await titles(a)).some((t) => t.includes("時間或地點有更新")));
  // 清單類：不能報名
  const l = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "素材", isList: true, status: "published" } })).data;
  assert.equal((await call("POST", "/orders", { token: a, body: { courseIds: [l.id] } })).status, 400);
});
