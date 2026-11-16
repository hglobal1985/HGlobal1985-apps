import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail, Notice, Order, ReviewDesk } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

function setup() {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub })).data.token;
  return { env, call, login };
}

test("審核窗口：邀請網址（一次性、24 小時）指定會員、可刪除；指定身份；學員與他人不能管理", async () => {
  const { env, call, login } = setup();
  const [admin, desk, pres, taipei, taichung] = await Promise.all(["demo-admin", "demo-desk", "demo-president", "demo-student", "demo-silver"].map(login));
  const course = (await call<CourseDetail>("POST", "/admin/courses", admin, { title: "付費審核課", teacher: "王小明", priceTwd: 500, hostUnit: "台北中心", status: "published" })).data;
  const id = course.id;
  assert.equal((await call("GET", `/admin/courses/${id}/review-desk`, taipei)).status, 403, "學員不能看審核窗口");
  assert.equal((await call("GET", "/admin/orders", desk)).status, 403, "還不是審核人員");

  // 產生邀請網址 → 窗口打開、接受 → 成為審核人員
  const inv = (await call<{ path: string; expiresAt: string }>("POST", `/admin/courses/${id}/review-invites`, admin)).data;
  assert.match(inv.path, /^\/review-invite\/[a-f0-9]{36}$/);
  const token = inv.path.split("/").pop()!;
  assert.ok(Date.parse(inv.expiresAt) - Date.now() > 23.9 * 3600 * 1000, "24 小時有效");
  assert.equal((await call("GET", `/review-invites/${token}`)).status, 401, "要先登入");
  assert.equal((await call<{ state: string }>("GET", `/review-invites/${token}`, desk)).data.state, "open");
  const ok = await call<{ courseTitle: string }>("POST", `/review-invites/${token}/accept`, desk);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.courseTitle, "付費審核課");
  assert.equal((await call("POST", `/review-invites/${token}/accept`, desk)).status, 200, "自己再按一次沒關係");
  assert.equal((await call("POST", `/review-invites/${token}/accept`, taichung)).status, 410, "一次性：別人不能再用");

  // 有人報名 → 指定的審核人員收到通知、看得到、可以審核
  const [order] = (await call<Order[]>("POST", "/orders", taipei, { courseIds: [id] })).data;
  assert.ok((await call<Notice[]>("GET", "/notifications", desk)).data.some((n) => n.title === "有新的報名待審核"));
  assert.deepEqual((await call<Order[]>("GET", "/admin/orders", desk)).data.map((o) => o.id), [order!.id]);

  let deskView = (await call<ReviewDesk>("GET", `/admin/courses/${id}/review-desk`, admin)).data;
  assert.deepEqual(deskView.members.map((m) => m.sub), ["demo-desk"]);
  deskView = (await call<ReviewDesk>("DELETE", `/admin/courses/${id}/reviewers/demo-desk`, admin)).data;
  assert.equal(deskView.members.length, 0);
  assert.equal((await call("GET", "/admin/orders", desk)).status, 403, "刪除後就不能審核");

  // 過期的邀請網址不能用
  const inv2 = (await call<{ path: string }>("POST", `/admin/courses/${id}/review-invites`, admin)).data.path.split("/").pop()!;
  await env.DB.prepare("UPDATE review_invites SET expires_at = '2000-01-01T00:00:00.000Z' WHERE used_by_sub IS NULL").run();
  assert.equal((await call<{ state: string }>("GET", `/review-invites/${inv2}`, desk)).data.state, "expired");
  assert.equal((await call("POST", `/review-invites/${inv2}/accept`, desk)).status, 410);

  // 指定身份：主辦中心（台北）的會長也能審核其他中心學員的報名
  const [o2] = (await call<Order[]>("POST", "/orders", taichung, { courseIds: [id] })).data;
  assert.ok(!(await call<Order[]>("GET", "/admin/orders", pres)).data.some((o) => o.id === o2!.id), "會長原本只看自己中心學員");
  assert.equal((await call("PUT", `/admin/courses/${id}/review-roles`, admin, { roles: ["president", "bogus"] })).status, 200);
  assert.deepEqual((await call<ReviewDesk>("GET", `/admin/courses/${id}/review-desk`, admin)).data.roles, ["president"]);
  assert.ok((await call<Order[]>("GET", "/admin/orders", pres)).data.some((o) => o.id === o2!.id), "勾了會長身份就看得到這門課所有報名");
});

test("系列只限超級管理員設定；新增課程可帶主講人獎銜與職稱", async () => {
  const { call, login } = setup();
  const [admin, pres] = await Promise.all(["demo-admin", "demo-president"].map(login));
  const mine = (await call<CourseDetail>("POST", "/admin/courses", pres, { title: "會長的課", teacher: "李四", teacherTitle: "講師" })).data;
  assert.equal(mine.teacherTitle, "講師");
  assert.equal((await call("PATCH", `/admin/courses/${mine.id}`, pres, { series: "自己的系列" })).status, 403);
  assert.equal((await call("POST", "/admin/courses", pres, { title: "x", teacher: "李四", series: "偷設系列" })).status, 403);
  assert.equal((await call("PATCH", `/admin/courses/${mine.id}`, admin, { series: "總部系列" })).status, 200);
});
