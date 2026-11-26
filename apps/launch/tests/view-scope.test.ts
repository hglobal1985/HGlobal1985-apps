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

test("誰可以瀏覽：預設、六種範圍、私密連結、報名限制", async () => {
  const { call, login } = setup();
  const admin = await login("demo-admin");
  const student = await login("demo-student");
  const make = async (body: Record<string, unknown>) => (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { status: "published", priceTwd: 0, ...body } })).data;

  // 預設：一般課程＝所有會員；清單＝所有人
  const reg = await make({ title: "一般課" });
  assert.equal(reg.viewScope, "all", "新課程預設「所有人含訪客」");
  await call("PATCH", `/admin/courses/${reg.id}`, { token: admin, body: { viewScope: "members", minRankCode: "gold" } });
  assert.equal((await call<CourseDetail>("GET", `/courses/${reg.id}`, { token: admin })).data.minRank.code, "gold");
  // 改成「所有人含訪客」：獎銜限制照樣保留（訪客看得到介紹、不能報名；杜杜龍 2026-11-17 規則 B），但不算「完全公開」
  const toAll = (await call<CourseDetail>("PATCH", `/admin/courses/${reg.id}`, { token: admin, body: { viewScope: "all", minRankCode: "gold" } })).data;
  assert.equal(toAll.minRank.code, "gold");
  assert.equal(toAll.isPublic, false);
  assert.equal((await call<CourseDetail>("PATCH", `/admin/courses/${reg.id}`, { token: admin, body: { title: "改名不會清掉獎銜" } })).data.minRank.code, "gold");
  await call("PATCH", `/admin/courses/${reg.id}`, { token: admin, body: { viewScope: "members" } });
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

  // 私密連結：不在任何清單，拿到網址才開得了；「需登入」的訪客 401、「訪客可」的訪客也能開
  await call("PATCH", `/admin/courses/${list.id}`, { token: admin, body: { viewScope: "link_guest" } });
  assert.ok(!(await call<CourseSummary[]>("GET", "/courses")).data.some((c) => c.id === list.id));
  assert.ok(!(await call<CourseSummary[]>("GET", "/courses", { token: student })).data.some((c) => c.id === list.id));
  assert.equal((await call("GET", `/courses/${list.id}`)).status, 200);
  await call("PATCH", `/admin/courses/${list.id}`, { token: admin, body: { viewScope: "link_login" } });
  assert.equal((await call("GET", `/courses/${list.id}`)).status, 401);
  assert.equal((await call("GET", `/courses/${list.id}`, { token: student })).status, 200);
  assert.ok((await call<CourseSummary[]>("GET", "/courses", { token: out })).data.every((c) => c.id !== list.id)); // 沒開過的人清單裡沒有（開過的人只在自己的「學習中」）
  assert.equal((await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "新課" } })).data.allowPresident, true);

  // isPublic 由設定推算：所有會員的免費課不是「免登入可看」
  const m = (await call<CourseDetail>("PATCH", `/admin/courses/${reg.id}`, { token: admin, body: { viewScope: "members" } })).data;
  assert.equal(m.isPublic, false);
});
