import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail, Roster, SeriesApplyPlan, SeriesApplyResult, SeriesRosterPlan } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("系列「套用到全系列課程」：只套用勾選的欄位、有人報名的費用不覆蓋、新增課程沿用範本、只有超級管理員", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const tok = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const admin = await tok("demo-admin");
  const pres = await tok("demo-president");
  const stu = await tok("demo-student");
  const mk = async (title: string, price: number) => {
    const c = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title, teacher: "王", status: "published", priceTwd: price, series: "套用系列" } })).data;
    await call("POST", `/admin/courses/${c.id}/lessons`, { token: admin, body: { title: "第一堂" } });
    return c;
  };
  const a = await mk("甲課", 0);
  const b = await mk("乙課", 0);
  const c = await mk("丙課（付費）", 3000);
  await call("POST", "/orders", { token: stu, body: { courseIds: [c.id] } }); // 丙課已有人報名（待審核）

  // 權限與欄位檢查
  const apply = (token: string, body: unknown) => call<SeriesApplyPlan & SeriesApplyResult>("POST", "/admin/series-apply", { token, body });
  assert.equal((await apply(pres, { series: "套用系列", fields: { inviteOnly: true } })).status, 403, "只有超級管理員");
  assert.equal((await apply(admin, { series: "套用系列", fields: { title: "不行" } })).status, 400, "名稱不能套用");
  assert.equal((await apply(admin, { series: "套用系列", fields: {} })).status, 400);

  // 預覽：丙課的費用被略過
  const fields = { inviteOnly: true, inviteCode: "6666", viewScope: "members", priceTwd: 500 };
  const dry = (await apply(admin, { series: "套用系列", fields, dry: true })).data;
  assert.equal(dry.courses.length, 3);
  const dc = dry.courses.find((x) => x.id === c.id)!;
  assert.deepEqual(dc.skipped.map((x) => x.key), ["priceTwd"]);
  assert.ok(!dc.apply.includes("priceTwd"));
  assert.equal(((await call<CourseDetail>("GET", `/courses/${a.id}`, { token: admin })).data).inviteOnly, false, "預覽不會真的改");

  // 套用
  const res = (await apply(admin, { series: "套用系列", fields })).data;
  assert.equal(res.applied, 3);
  assert.deepEqual(res.failed, []);
  const A = (await call<CourseDetail>("GET", `/courses/${a.id}`, { token: admin })).data;
  const C = (await call<CourseDetail>("GET", `/courses/${c.id}`, { token: admin })).data;
  assert.equal(A.inviteOnly, true);
  assert.equal(A.viewScope, "members");
  assert.equal(A.priceTwd, 500, "沒人報名的課程費用被改");
  assert.equal(A.title, "甲課", "沒勾的欄位不動");
  assert.equal(C.priceTwd, 3000, "有人報名的課程費用不覆蓋");
  assert.equal(C.inviteOnly, true);
  assert.equal((await call<{ code: string }>("GET", `/admin/courses/${b.id}/invite`, { token: admin })).data.code, "6666");

  // 新增課程預設沿用範本（名稱、主講人不在範本裡）
  const n = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "新課", teacher: "李", series: "套用系列" } })).data;
  assert.equal(n.inviteOnly, true);
  assert.equal(n.viewScope, "members");
  assert.equal(n.title, "新課");
  assert.equal(((await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "別系列課", teacher: "李", series: "別的系列" } })).data).inviteOnly, false);
  const tpl = (await call<{ template: Record<string, unknown> }>("GET", `/admin/series-template?series=${encodeURIComponent("套用系列")}`, { token: admin })).data.template;
  assert.equal(tpl.inviteCode, "6666");
});

test("系列第七項：把一門課的已開通學員批次加入同系列其他課程（略過已報名、教材卡、已封存）", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const tok = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const admin = await tok("demo-admin");
  const s1 = await tok("demo-student");
  const s2 = await tok("demo-silver");
  const mk = async (title: string) => {
    const c = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title, teacher: "王", status: "published", priceTwd: 0, series: "批次系列" } })).data;
    await call("POST", `/admin/courses/${c.id}/lessons`, { token: admin, body: { title: "第一堂" } });
    return c;
  };
  const a = await mk("來源課");
  const b = await mk("目標課");
  await call("POST", "/orders", { token: s1, body: { courseIds: [a.id] } });
  await call("POST", "/orders", { token: s2, body: { courseIds: [a.id] } });
  await call("POST", "/orders", { token: s1, body: { courseIds: [b.id] } }); // s1 已經在目標課
  const join = (body: unknown) => call<SeriesRosterPlan & { added: number }>("POST", "/admin/series-apply-roster", { token: admin, body });
  const plan = (await join({ series: "批次系列", sourceCourseId: a.id, dry: true })).data;
  assert.equal(plan.source.members, 2);
  assert.deepEqual(plan.targets.map((t) => [t.add, t.already]), [[1, 1]]);
  assert.equal(plan.totalAdd, 1);
  const done = (await join({ series: "批次系列", sourceCourseId: a.id })).data;
  assert.equal(done.added, 1);
  const roster = (await call<Roster>("GET", `/admin/courses/${b.id}/roster`, { token: admin })).data;
  assert.equal(roster.rows.length, 2);
  assert.ok(roster.rows.some((r) => r.method === "batch" && r.status === "opened"));
  assert.equal(((await call<CourseDetail>("GET", `/courses/${b.id}`, { token: s2 })).data).enrollment, "opened");
  assert.ok((await call<{ title: string }[]>("GET", "/notifications", { token: s2 })).data.some((n) => n.title === "已加入課程"));
  assert.equal((await join({ series: "批次系列", sourceCourseId: a.id })).data.added, 0, "再套用一次不會重複加入");
});
