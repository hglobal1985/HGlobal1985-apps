import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail, CourseSummary } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

function setup() {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(
      new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }),
      env,
    );
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  return { call, login };
}

test("誰可以瀏覽：預設、四種範圍、訪客隱藏、報名限制", async () => {
  const { call, login } = setup();
  const admin = await login("demo-admin");
  const student = await login("demo-student");
  const make = async (body: Record<string, unknown>) => (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { status: "published", priceTwd: 0, ...body } })).data;

  // 預設：一般課程＝所有會員；清單＝所有人
  const reg = await make({ title: "一般課" });
  assert.equal(reg.viewScope, "members");
  const list = await make({ title: "清單", isList: true });
  assert.equal(list.viewScope, "all");
  assert.equal(list.isPublic, true);

  // 訪客：會員課 401、不在清單；清單看得到
  assert.equal((await call("GET", `/courses/${reg.id}`)).status, 401);
  const guestList = (await call<CourseSummary[]>("GET", "/courses")).data.map((c) => c.id);
  assert.ok(!guestList.includes(reg.id));
  assert.ok(guestList.includes(list.id));
  assert.equal((await call("GET", `/courses/${reg.id}`, { token: student })).status, 200);

  // 寰宇夥伴／中心會員：不符資格的登入者 404、不在清單、不能報名
  const hg = (await call<CourseDetail>("PATCH", `/admin/courses/${reg.id}`, { token: admin, body: { viewScope: "hglobal" } })).data;
  assert.equal(hg.viewScope, "hglobal");
  const out = await login("demo-outsider");
  assert.equal((await call("GET", `/courses/${reg.id}`, { token: out })).status, 404);
  assert.equal((await call("GET", `/courses/${reg.id}`, { token: student })).status, 200);
  assert.ok(!(await call<CourseSummary[]>("GET", "/courses", { token: out })).data.some((c) => c.id === reg.id));
  assert.equal((await call("POST", "/orders", { token: out, body: { courseIds: [reg.id] } })).status, 403);
  // 中心會員：非寰宇、沒有中心的看不到；有中心的看得到
  await call("PATCH", `/admin/courses/${reg.id}`, { token: admin, body: { viewScope: "center" } });
  assert.equal((await call("GET", `/courses/${reg.id}`, { token: out })).status, 404);
  assert.equal((await call("GET", `/courses/${reg.id}`, { token: student })).status, 200);

  // 錯誤值被擋
  assert.equal((await call("PATCH", `/admin/courses/${reg.id}`, { token: admin, body: { viewScope: "訪客" } })).status, 400);

  // 所有人＋對訪客隱藏：訪客清單與搜尋沒有，但知道網址可開
  const hidden = (await call<CourseDetail>("PATCH", `/admin/courses/${list.id}`, { token: admin, body: { hideFromGuests: true } })).data;
  assert.equal(hidden.hideFromGuests, true);
  assert.ok(!(await call<CourseSummary[]>("GET", "/courses")).data.some((c) => c.id === list.id));
  assert.equal((await call("GET", `/courses/${list.id}`)).status, 200);
  assert.ok((await call<CourseSummary[]>("GET", "/courses", { token: student })).data.some((c) => c.id === list.id));

  // isPublic 由設定推算：所有會員的免費課不是「免登入可看」
  const m = (await call<CourseDetail>("PATCH", `/admin/courses/${reg.id}`, { token: admin, body: { viewScope: "members" } })).data;
  assert.equal(m.isPublic, false);
});
