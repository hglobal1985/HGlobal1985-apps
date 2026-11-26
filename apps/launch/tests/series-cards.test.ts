import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("系列卡：沒有系列的教材卡一律進「未分類」；系列設定與隱藏只有超級管理員能改", async () => {
  const db = createTestDb();
  const env = { DB: db, DEMO_LOGIN: "on" } as never;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as Record<string, unknown> };
  };
  const login = async (sub: string) => ((await call("POST", "/auth/demo", { sub })).data as { token: string }).token;
  const admin = await login("demo-admin");
  const student = await login("demo-student");
  const course = await call("POST", "/admin/courses", { title: "新課程" }, admin);
  assert.equal(course.status, 200);
  assert.equal(course.data.series, "未分類");
  const list = await call("POST", "/admin/courses", { title: "新清單", isList: true }, admin);
  assert.equal(list.data.series, "未分類"); // 清單型教材卡也一樣（杜杜龍 2026-11-20）
  // 課程卡清掉系列＝回到「未分類」
  await call("PATCH", `/admin/courses/${course.data.id}`, { series: "測試系列" }, admin);
  const back = await call("PATCH", `/admin/courses/${course.data.id}`, { series: "" }, admin);
  assert.equal(back.data.series, "未分類");
  // 系列設定：標題與是否顯示在所有系列
  assert.equal((await call("PUT", "/admin/series-settings", { series: "測試系列", title: "新標題", showInAll: false }, student)).status, 403);
  assert.equal((await call("PUT", "/admin/series-settings", { series: "測試系列", title: "新標題", showInAll: false }, admin)).status, 200);
  const settings = (await call("GET", "/series-settings")).data as unknown as { series: string; title: string; showInAll: boolean }[];
  assert.deepEqual(settings.find((x) => x.series === "測試系列"), { series: "測試系列", title: "新標題", showInAll: false });
  // 隱藏：只有超級管理員，課程列表帶 seriesHidden
  assert.equal((await call("POST", "/admin/series-hide", { id: course.data.id, hidden: true }, student)).status, 403);
  assert.equal((await call("POST", "/admin/series-hide", { id: course.data.id, hidden: true }, admin)).status, 200);
  const row = (await db.prepare("SELECT series_hidden FROM courses WHERE id = ?").bind(course.data.id as string).first<{ series_hidden: number }>())!;
  assert.equal(row.series_hidden, 1);
});
