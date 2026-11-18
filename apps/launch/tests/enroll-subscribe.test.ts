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
  const l = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "素材", isList: true } })).data;
  assert.equal(l.status, "published", "新增素材清單自動直接上架");
  assert.equal((await call("POST", "/orders", { token: a, body: { courseIds: [l.id] } })).status, 400);
});

test("Email 通知依情境開關：預設只有付費課程審核通知；可改；通知分類正確", async () => {
  const { noticeKindOf } = await import("../src/contract.ts");
  assert.equal(noticeKindOf("報名已送出，等待審核", "/orders/o1"), "paid_review");
  assert.equal(noticeKindOf("獲得學習徽章", "/achievements"), "badge");
  assert.equal(noticeKindOf("某某課有新章節", "/course/x"), "course_update");
  assert.equal(noticeKindOf("新竹中心廣播公告", "/courses"), "broadcast");
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const t = ((await call<{ token: string }>("POST", "/auth/demo", { body: { sub: "demo-student" } })).data).token;
  const get = async () => (await call<{ emailKinds: Record<string, boolean> }>("GET", "/me/notification-settings", { token: t })).data.emailKinds;
  const d = await get();
  assert.deepEqual(Object.entries(d).filter(([, v]) => v).map(([k]) => k), ["paid_review"]);
  const after = (await call<{ emailKinds: Record<string, boolean> }>("PUT", "/me/notification-settings", { token: t, body: { emailKinds: { badge: true, paid_review: false } } })).data.emailKinds;
  assert.deepEqual([after.badge, after.paid_review, after.comment], [true, false, false]);
});

test("素材系列手動排序：只有超級管理員、只能排這個系列的項目", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const tok = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const admin = await tok("demo-admin");
  const student = await tok("demo-student");
  const mk = async (title: string) => (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title, isList: true, series: "新品" } })).data.id;
  const [a, b, c] = [await mk("甲"), await mk("乙"), await mk("丙")];
  assert.equal((await call("POST", "/admin/series-order", { token: student, body: { series: "新品", ids: [c, b, a] } })).status, 403);
  assert.equal((await call("POST", "/admin/series-order", { token: admin, body: { series: "新品", ids: [c, b, "nope"] } })).status, 400);
  assert.equal((await call("POST", "/admin/series-order", { token: admin, body: { series: "新品", ids: [c, a, b] } })).status, 200);
  const list = (await call<{ id: string; seriesOrder: number }[]>("GET", "/courses", { token: admin })).data.filter((x) => [a, b, c].includes(x.id));
  assert.deepEqual(list.sort((x, y) => x.seriesOrder - y.seriesOrder).map((x) => x.id), [c, a, b]);
});
