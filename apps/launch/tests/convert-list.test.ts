import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("轉成素材：一般課程的章節變成素材項目、課程專屬設定捨棄；已有人報名不能轉；只有超級管理員", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const tok = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const admin = await tok("demo-admin");
  const student = await tok("demo-student");
  const c = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "線上溝通會", teacher: "王小明", status: "published", priceTwd: 0, minRankCode: "platinum" } })).data;
  await call("POST", `/admin/courses/${c.id}/lessons`, { token: admin, body: { title: "第一堂", sharer: "李老師" } });
  await call("POST", `/admin/courses/${c.id}/lessons`, { token: admin, body: { title: "第二堂" } });
  assert.equal((await call("POST", `/admin/courses/${c.id}/convert-to-list`, { token: student })).status, 403);
  const d = (await call<CourseDetail>("POST", `/admin/courses/${c.id}/convert-to-list`, { token: admin })).data;
  assert.equal(d.isList, true);
  assert.equal(d.minRank.code, "none");
  assert.equal(d.teacher ?? "", "");
  assert.ok(d.lessons.length >= 2 && d.lessons.every((l) => !!l.material && !l.sharer));
  assert.equal((await call("POST", `/admin/courses/${c.id}/convert-to-list`, { token: admin })).status, 400);
  // 已有人報名的課程不能轉
  const e = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "有人報名", teacher: "王", status: "published", priceTwd: 0 } })).data;
  await db.prepare("INSERT INTO orders (id, member_sub, member_name_snapshot, status, total_twd) VALUES ('o1', 'demo-student', 'x', 'opened', 0)").run();
  await db.prepare("INSERT INTO order_items (order_id, course_id, title_snapshot, price_twd) VALUES ('o1', ?, 'x', 0)").bind(e.id).run();
  assert.equal((await call("POST", `/admin/courses/${e.id}/convert-to-list`, { token: admin })).status, 400);
});
