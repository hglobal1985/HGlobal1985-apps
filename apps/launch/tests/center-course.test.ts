import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { romanizeName } from "../src/romanize.ts";
import { createTestDb } from "./sqlite-d1.ts";

function setup() {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub })).data.token;
  return { call, login };
}

test("中心課程由主辦單位自動決定（不再手動勾選）：只有總部＝一般課程，含中心＝中心課程；中心音控建立的一定是中心課程", async () => {
  const { call, login } = setup();
  const admin = await login("demo-admin");
  const a = await call<CourseDetail>("POST", "/admin/courses", admin, { title: "總部課", hostUnit: "寰宇總部" });
  assert.equal(a.data.centerCourse, false);
  await call("PATCH", `/admin/courses/${a.data.id}`, admin, { centerCourse: true });
  assert.equal((await call<CourseDetail>("GET", `/courses/${a.data.id}`, admin)).data.centerCourse, false, "手動設定不再有效");
  await call("PATCH", `/admin/courses/${a.data.id}`, admin, { hostUnit: "南京 062" });
  assert.equal((await call<CourseDetail>("GET", `/courses/${a.data.id}`, admin)).data.centerCourse, true, "主辦單位改成中心＝中心課程");
  await call("PATCH", `/admin/courses/${a.data.id}`, admin, { hostUnit: "寰宇總部" });
  assert.equal((await call<CourseDetail>("GET", `/courses/${a.data.id}`, admin)).data.centerCourse, false);

  const president = await login("demo-president");
  const b = await call<CourseDetail>("POST", "/admin/courses", president, { title: "中心課" });
  assert.equal(b.data.centerCourse, true);
});

test("英譯姓名：中文拼音、複姓、英文去音標、韓文、日文假名", () => {
  assert.equal(romanizeName("王小明"), "wang-xiaoming");
  assert.equal(romanizeName("歐陽娜娜"), "ouyang-nana");
  assert.equal(romanizeName("José Núñez"), "jose-nunez");
  assert.equal(romanizeName("John Smith"), "john-smith");
  assert.equal(romanizeName("박지성"), "bak-jiseong");
  assert.equal(romanizeName("タナカ ヒロシ"), "tanaka-hiroshi");
  assert.equal(romanizeName("  "), "");
});

test("課程專屬網址：中心縮寫＋英譯主講人-編號；同一主講人依序編號；固定不變；缺資料沒有；路由可查詢；換中心重新產生", async () => {
  const { call, login } = setup();
  const admin = await login("demo-admin");
  const mk = async (title: string, teacher: string, hostUnit = "南京 062") => (await call<CourseDetail>("POST", "/admin/courses", admin, { title, teacher, hostUnit })).data;
  const c0 = await mk("早先建立", "王小明");
  assert.equal(c0.shortPath, null, "中心還沒設縮寫＝沒有專屬網址");
  assert.equal((await call("PUT", "/admin/short-links", admin, { kind: "center", value: "南京 062", slug: "nj" })).status, 200);
  const c1 = await mk("第一場", "王小明");
  const c2 = await mk("第二場", "王小明");
  const other = await mk("別人", "李華");
  const noTeacher = await mk("沒有主講人", "");
  assert.equal((await call<CourseDetail>("GET", `/courses/${c0.id}`, admin)).data.shortPath, "nj/wang-xiaoming-001", "設定縮寫後自動補上，依建立順序編號");
  assert.equal((await call<CourseDetail>("GET", `/courses/${c1.id}`, admin)).data.shortPath, "nj/wang-xiaoming-002");
  assert.equal(c2.shortPath, "nj/wang-xiaoming-003");
  assert.equal(other.shortPath, "nj/li-hua-001");
  assert.equal(noTeacher.shortPath, null);
  await call("PATCH", `/admin/courses/${c1.id}`, admin, { teacher: "別人" });
  assert.equal((await call<CourseDetail>("GET", `/courses/${c1.id}`, admin)).data.shortPath, "nj/wang-xiaoming-002", "改主講人不會改網址");
  const found = await call<{ courseId: string }>("GET", "/short-links/nj/wang-xiaoming-002");
  assert.equal(found.data.courseId, c1.id);
  assert.equal((await call("GET", "/short-links/nj/wang-xiaoming-099")).status, 404);
  await call("PATCH", `/admin/courses/${c2.id}`, admin, { hostUnit: "台北 001" });
  assert.equal((await call<CourseDetail>("GET", `/courses/${c2.id}`, admin)).data.shortPath, null, "換到沒有縮寫的中心＝沒有網址");
});

test("課程專屬網址：縮寫照設定的大小寫顯示、輸入不分大小寫；總部（沒有主辦中心）課程用 hq", async () => {
  const { call, login } = setup();
  const admin = await login("demo-admin");
  await call("PUT", "/admin/short-links", admin, { kind: "center", value: "南京 062", slug: "NJ" });
  const mk = async (title: string, teacher: string, hostUnit: string) => (await call<CourseDetail>("POST", "/admin/courses", admin, { title, teacher, hostUnit, status: "published" })).data;
  const a = await mk("中心課", "王小明", "南京 062");
  const h1 = await mk("總部課一", "王儷凱", "寰宇總部");
  const h2 = await mk("總部課二", "王儷凱", "寰宇總部");
  assert.equal(a.shortPath, "NJ/wang-xiaoming-001", "照設定的大小寫顯示");
  assert.equal(h1.shortPath, "hq/wang-likai-001", "總部課程用 hq");
  assert.equal(h2.shortPath, "hq/wang-likai-002", "總部同一主講人依序編號");
  for (const path of ["NJ/wang-xiaoming-001", "nj/wang-xiaoming-001", "Nj/WANG-XIAOMING-001"]) assert.equal((await call<{ courseId: string }>("GET", `/short-links/${path}`)).data.courseId, a.id, path);
  for (const path of ["hq/wang-likai-002", "HQ/Wang-Likai-002"]) assert.equal((await call<{ courseId: string }>("GET", `/short-links/${path}`)).data.courseId, h2.id, path);
  assert.equal((await call("GET", "/short-links/hq/wang-likai-099")).status, 404);
});

test("短影音專輯：勾選存得住；單元索引納入短影音專輯的影音教材、不含非影音", async () => {
  const { call, login } = setup();
  const admin = await login("demo-admin");
  const c = (await call<CourseDetail>("POST", "/admin/courses", admin, { title: "短影音課", hostUnit: "寰宇總部", status: "published", isShorts: true })).data;
  assert.equal(c.isShorts, true);
  await call("PATCH", `/admin/courses/${c.id}`, admin, { status: "published" });
  const withMedia = (await call<CourseDetail>("POST", `/admin/courses/${c.id}/lessons`, admin, { title: "影音教材", kind: "material" })).data.lessons.find((l) => l.title === "影音教材")!.id;
  await call("PATCH", `/admin/lessons/${withMedia}`, admin, { mediaType: "youtube", mediaRef: "dQw4w9WgXcQ" });
  await call("POST", `/admin/courses/${c.id}/lessons`, admin, { title: "沒有影音的教材", kind: "material" });
  const idx = (await call<{ lessons: { id: string; isShorts: boolean; isMaterial: boolean }[] }>("GET", "/search-index", admin)).data.lessons.filter((l) => l.isMaterial);
  assert.deepEqual(idx.map((l) => [l.id, l.isShorts]), [[withMedia, true]]);
});
