import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("中心訂閱（從 688 開始、可取消）與廣播公告（新增、秒數、通知訂閱者）", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const [admin, a, b] = await Promise.all([login("demo-admin"), login("demo-student"), login("demo-silver")]);
  type St = { count: number; subscribed: boolean };
  assert.deepEqual((await call<St>("GET", "/center-subscription?center=台北中心")).data, { count: 688, subscribed: false }, "全部中心都從 688 開始");
  assert.equal((await call("POST", "/center-subscription", { body: { center: "台北中心" } })).status, 401, "訪客要先登入");
  assert.deepEqual((await call<St>("POST", "/center-subscription", { token: a, body: { center: "台北中心" } })).data, { count: 689, subscribed: true });
  assert.equal((await call<St>("POST", "/center-subscription", { token: b, body: { center: "台北中心" } })).data.count, 690);
  assert.deepEqual((await call<St>("POST", "/center-subscription", { token: b, body: { center: "台北中心" } })).data, { count: 689, subscribed: false }, "再按一下取消訂閱");
  assert.equal((await call<St>("GET", "/center-subscription?center=台中中心")).data.count, 688, "別的中心不受影響");

  // 廣播公告：只有能編輯中心封面的人（總部、該中心會長）可以；新增時通知訂閱者
  assert.equal((await call("POST", "/admin/broadcasts", { token: a, body: { scope: "center", name: "台北中心", text: "x" } })).status, 403);
  const added = await call<{ seconds: number; items: { id: string; text: string; date: string; scope: string }[] }>("POST", "/admin/broadcasts", { token: admin, body: { scope: "center", name: "台北中心", text: "本週三晚上 8 點開課" } });
  assert.equal(added.status, 200);
  assert.equal(added.data.seconds, 2, "預設 2 秒");
  assert.equal(added.data.items[0]!.scope, "center");
  assert.equal(added.data.items[0]!.text, "本週三晚上 8 點開課");
  assert.match(added.data.items[0]!.date, /^\d{4}\/\d{2}\/\d{2}$/);
  const notices = (await call<{ title: string; body: string }[]>("GET", "/notifications", { token: a })).data;
  assert.ok(notices.some((n) => n.title.includes("廣播公告") && n.body.includes("開課")), "訂閱者收到通知");
  assert.equal(((await call<{ title: string }[]>("GET", "/notifications", { token: b })).data).some((n) => n.title.includes("廣播公告")), false, "沒訂閱的不通知");
  assert.equal((await call<{ seconds: number }>("PUT", "/admin/center-broadcast-seconds", { token: admin, body: { center: "台北中心", seconds: 5 } })).data.seconds, 5);
  assert.equal((await call("PUT", "/admin/center-broadcast-seconds", { token: admin, body: { center: "台北中心", seconds: 0 } })).status, 400);
  assert.equal((await call<{ items: unknown[] }>("GET", "/broadcasts?center=台北中心")).data.items.length, 1, "公開可讀");

  // 新課程上架通知訂閱者
  const made = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "新開的課", teacher: "王小明", hostUnit: "台北中心", priceTwd: 0 } })).data;
  await call("PATCH", `/admin/courses/${made.id}`, { token: admin, body: { status: "published" } });
  assert.ok((await call<{ title: string; body: string }[]>("GET", "/notifications", { token: a })).data.some((n) => n.title.includes("有新課程上架") && n.body.includes("新開的課")));
  // 上架的人自己也會收到一則確認通知（含通知人數），方便確認有沒有送出去
  assert.ok((await call<{ title: string; body: string }[]>("GET", "/notifications", { token: admin })).data.some((n) => n.title.includes("已送出") && n.body.includes("新開的課") && n.body.includes("通知了 1 位訂閱者")));

  // 系列訂閱：同一套邏輯，系列有新課程上架通知訂閱者
  assert.deepEqual((await call<St>("GET", "/series-subscription?series=美力之星")).data, { count: 688, subscribed: false });
  assert.equal((await call("POST", "/series-subscription", { body: { series: "美力之星" } })).status, 401);
  assert.deepEqual((await call<St>("POST", "/series-subscription", { token: b, body: { series: "新系列" } })).data, { count: 689, subscribed: true });
  const m2 = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "系列新課", teacher: "王小明", hostUnit: "台北中心", priceTwd: 0, series: "新系列" } })).data;
  await call("PATCH", `/admin/courses/${m2.id}`, { token: admin, body: { status: "published" } });
  assert.ok((await call<{ title: string; body: string }[]>("GET", "/notifications", { token: b })).data.some((n) => n.title.includes("新系列有新課程上架") && n.body.includes("系列新課")));

  // 系列裡的課程新增章節／教材：通知系列訂閱者；30 分鐘內同類型合併；新增的人自己收到確認
  const before = (await call<{ title: string }[]>("GET", "/notifications", { token: b })).data.filter((n) => n.title === "新系列有新章節").length;
  assert.equal((await call("POST", `/admin/courses/${m2.id}/lessons`, { token: admin, body: { title: "第一堂" } })).status, 200);
  assert.equal((await call("POST", `/admin/courses/${m2.id}/lessons`, { token: admin, body: { title: "第二堂" } })).status, 200);
  const after = (await call<{ title: string; body: string }[]>("GET", "/notifications", { token: b })).data.filter((n) => n.title === "新系列有新章節");
  assert.equal(after.length, before + 1, "30 分鐘內同一門課只通知一次");
  const mine = (await call<{ title: string; body: string }[]>("GET", "/notifications", { token: admin })).data.filter((n) => n.title === "已送出「新章節」通知");
  assert.equal(mine.length, 1, "新增的人的確認通知 30 分鐘內合併成一則（杜杜龍 2026-11-24：一次傳 40 張照片不再跳 40 則）");
  assert.ok(mine[0]!.body.includes("通知了 1 位系列訂閱者") && mine[0]!.body.includes("共新增 2 次"));
  assert.equal((await call("POST", `/admin/courses/${m2.id}/materials`, { token: admin, body: { url: "https://example.com/a.pdf", title: "講義" } })).status, 200);
  assert.ok((await call<{ title: string }[]>("GET", "/notifications", { token: b })).data.some((n) => n.title === "新系列有新教材"));
});
