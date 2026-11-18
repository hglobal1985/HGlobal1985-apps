import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("課程與教材清單的封面：訂閱、點閱、訂閱者收到新教材通知、刪除課程一併清掉", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  const call = async <T = Record<string, any>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json().catch(() => null)) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const admin = await login("demo-admin");
  const student = await login("demo-student");
  const list = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { isList: true, title: "新品清單" } })).data;

  // 訂閱：訪客看得到人數、不能訂閱；學員訂閱／取消；找不到的課程 404
  assert.deepEqual((await call("GET", `/course-subscription?course=${list.id}`)).data, { count: 688, subscribed: false });
  assert.equal((await call("POST", "/course-subscription", { body: { course: list.id } })).status, 401);
  assert.equal((await call("GET", "/course-subscription?course=nope")).status, 404);
  assert.deepEqual((await call("POST", "/course-subscription", { token: student, body: { course: list.id } })).data, { count: 689, subscribed: true });
  assert.equal((await call<{ count: number; subscribed: boolean }>("GET", `/course-subscription?course=${list.id}`, { token: student })).data.subscribed, true);

  // 點閱：每進入一次 +1（訪客也算）；沒上架的課程不算
  assert.equal((await call("POST", "/course-views", { body: { courseId: list.id } })).data.total, 1);
  assert.equal((await call("POST", "/course-views", { body: { courseId: list.id } })).data.total, 2);
  const draft = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "草稿課" } })).data;
  assert.equal((await call("POST", "/course-views", { body: { courseId: draft.id } })).data.ok, false);

  // 新增教材：訂閱者收到通知（新增的管理員自己收到確認）
  const add = await call("POST", `/admin/courses/${list.id}/materials`, { token: admin, body: { url: "https://example.com/a.pdf", title: "新品簡報" } });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  const rows = await db.prepare("SELECT title FROM notifications WHERE title LIKE '%有新教材%'").all<{ title: string }>();
  assert.ok(rows.results.some((r) => r.title === "新品清單有新教材"), "訂閱者收到通知");
  // 同一個人取消訂閱後，不再收到
  await call("POST", "/course-subscription", { token: student, body: { course: list.id } });
  const before = (await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE title = '新品清單有新教材'").first<{ n: number }>())!.n;
  await db.prepare("DELETE FROM notifications").run();
  await call("POST", `/admin/courses/${list.id}/materials`, { token: admin, body: { url: "https://example.com/b.pdf", title: "第二份" } });
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE title = '新品清單有新教材'").first<{ n: number }>())!.n, 0, "取消訂閱後不通知");
  assert.ok(before >= 1);

  // 刪除課程：訂閱與點閱一併清掉
  await call("POST", "/course-subscription", { token: student, body: { course: list.id } });
  assert.equal((await call("DELETE", `/admin/courses/${list.id}`, { token: admin })).status, 200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM center_subscriptions WHERE center_key = ?").bind(`course:${list.id}`).first<{ n: number }>())!.n, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM page_views WHERE kind = 'course' AND key = ?").bind(list.id).first<{ n: number }>())!.n, 0);
});
