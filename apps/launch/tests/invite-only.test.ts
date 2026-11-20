import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail, Order } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("指定邀請制：沒邀請碼＝人工審核（免費課也要）、邀請碼正確＝直接開通並通知管理員、輸錯 5 次鎖定", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const tok = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const admin = await tok("demo-admin");
  const a = await tok("demo-student");
  const b = await tok("demo-silver");
  const c = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "邀請課", teacher: "王", status: "published", priceTwd: 0, minRankCode: "diamond" } })).data;
  // 設定：指定邀請制＋邀請碼
  assert.equal((await call("PATCH", `/admin/courses/${c.id}`, { token: admin, body: { inviteOnly: true, inviteCode: "8888" } })).status, 200);
  const inv = (await call<{ inviteOnly: boolean; code: string }>("GET", `/admin/courses/${c.id}/invite`, { token: admin })).data;
  assert.deepEqual(inv, { inviteOnly: true, code: "8888" });
  assert.equal((await call("GET", `/admin/courses/${c.id}/invite`, { token: a })).status, 403, "學員看不到邀請碼");
  const sum = (await call<CourseDetail>("GET", `/courses/${c.id}`, { token: a })).data;
  assert.equal(sum.inviteOnly, true);
  assert.equal(sum.inviteHasCode, true);
  assert.equal(JSON.stringify(sum).includes("8888"), false, "課程資料不洩漏邀請碼");
  assert.equal(sum.eligible, true, "指定邀請制不看獎銜");

  // 沒有邀請碼：免費課程也進待審核，審核人員收到通知
  const [pending] = (await call<Order[]>("POST", "/orders", { token: a, body: { courseIds: [c.id] } })).data;
  assert.equal(pending.status, "pending");
  assert.equal(pending.joinMethod, "invite_request");
  const adminTitles = async () => (await call<{ title: string }[]>("GET", "/notifications", { token: admin })).data.map((n) => n.title);
  assert.ok((await adminTitles()).some((t) => t.includes("新的報名待審核")));
  const queue = (await call<Order[]>("GET", "/admin/orders?status=pending", { token: admin })).data;
  assert.ok(queue.some((o) => o.id === pending.id), "金額 0 的邀請制申請也出現在審核清單");
  // 審核通過
  assert.equal((await call("POST", `/admin/orders/${pending.id}/review`, { token: admin, body: { action: "vip" } })).status, 200);
  assert.ok((await call<{ title: string }[]>("GET", "/notifications", { token: a })).data.some((n) => n.title === "報名審核通過，課程已開通"));

  // 輸錯：錯 4 次提示剩餘次數，第 5 次鎖定
  const wrong = async () => (await call<{ error: { code: string } }>("POST", "/orders", { token: b, body: { courseIds: [c.id], inviteCode: "0000" } }));
  for (let i = 0; i < 4; i++) {
    const r = await wrong();
    assert.equal(r.status, 403);
    assert.equal(r.data.error.code, "invite_wrong");
  }
  const locked = await wrong();
  assert.equal(locked.status, 429);
  // 鎖定期間連正確的也不行
  assert.equal((await call("POST", "/orders", { token: b, body: { courseIds: [c.id], inviteCode: "8888" } })).status, 429);
  // 另一個人輸入正確（不分大小寫、前後空白）：直接開通、金額 0，管理員收到通知
  const d = await tok("demo-desk");
  const third = await call<Order[]>("POST", "/orders", { token: d, body: { courseIds: [c.id], inviteCode: " 8888 " } });
  assert.equal(third.status, 200, JSON.stringify(third.data));
  const [joined] = third.data;
  assert.equal(joined.status, "opened");
  assert.equal(joined.payMethod, "vip");
  assert.equal(joined.joinMethod, "invite");
  assert.equal(joined.totalTwd, 0);
  assert.ok((await adminTitles()).some((t) => t.includes("有人使用邀請碼加入課程")));
  assert.ok((await call<{ title: string }[]>("GET", "/notifications", { token: d })).data.some((n) => n.title === "已透過邀請碼加入課程"));
});

test("指定邀請制：先按「無邀請碼」待審核，之後拿到邀請碼可直接加入；付費課程的邀請碼金額記 0", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", "x-client-platform": "web", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const tok = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const admin = await tok("demo-admin");
  const a = await tok("demo-student");
  const c = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "付費邀請課", teacher: "王", status: "published", priceTwd: 3000 } })).data;
  await call("PATCH", `/admin/courses/${c.id}`, { token: admin, body: { inviteOnly: true, inviteCode: "vip1" } });
  const [req] = (await call<Order[]>("POST", "/orders", { token: a, body: { courseIds: [c.id] } })).data;
  assert.equal(req.status, "pending");
  assert.equal(req.totalTwd, 3000, "沒有邀請碼走原本付費審核");
  const second = await call<Order[]>("POST", "/orders", { token: a, body: { courseIds: [c.id], inviteCode: "VIP1" } });
  assert.equal(second.status, 200, JSON.stringify(second.data));
  const [joined] = second.data;
  assert.equal(joined.status, "opened");
  assert.equal(joined.totalTwd, 0);
  assert.equal(joined.paidTwd, 0);
  const mine = (await call<Order[]>("GET", "/orders", { token: a })).data;
  assert.equal(mine.filter((o) => o.status === "pending").length, 0, "待審核的那筆已被取代");
});

test("指定邀請制：原本完全公開的免費課，勾選後訪客與未報名會員的章節、教材都鎖住", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const admin = (await call<{ token: string }>("POST", "/auth/demo", { body: { sub: "demo-admin" } })).data.token;
  const c = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "公開課", teacher: "王", status: "published", priceTwd: 0, viewScope: "all" } })).data;
  assert.equal((await call<CourseDetail>("GET", `/courses/${c.id}`)).data.isPublic, true, "勾選前是完全公開");
  assert.equal((await call("PATCH", `/admin/courses/${c.id}`, { token: admin, body: { inviteOnly: true } })).status, 200);
  const after = (await call<CourseDetail>("GET", `/courses/${c.id}`)).data;
  assert.equal(after.isPublic, false);
  assert.equal(after.isList, false, "指定邀請制是要報名的一般課程");
  assert.ok(after.lessons.every((l) => l.locked), "訪客看到的章節與教材全部鎖住");
});
