import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("YouTube 章節：沒有上傳封面時自動用影片縮圖（不再有「自動抓取」勾選，送了也不理）；新增課程沒有預設章節", async () => {
  const env: Env = { DB: createTestDb({ firstLesson: false }), DEMO_LOGIN: "on" };
  const call = async <T,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const token = (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub: "demo-admin" })).data.token;
  const made = await call<CourseDetail>("POST", "/admin/courses", token, { title: "縮圖測試", hostUnit: "寰宇總部", autoCover: true });
  assert.equal(made.status, 200);
  const id = made.data.id;
  assert.equal(made.data.lessons.length, 0, "新增課程不預設建立第一堂章節");
  assert.equal(made.data.autoCover, false, "自動抓取勾選已移除，送了也不理");
  assert.equal(made.data.coverUrl, null, "沒有任何 YouTube 章節：沒有封面");
  const withLesson = await call<CourseDetail>("POST", `/admin/courses/${id}/lessons`, token, { title: "第一堂", autoCover: true });
  const lessonId = withLesson.data.lessons[0]!.id;
  assert.equal(withLesson.data.lessons[0]!.autoCover, false);
  assert.equal((await call("PATCH", `/admin/lessons/${lessonId}`, token, { mediaType: "youtube", mediaRef: "https://youtu.be/dQw4w9WgXcQ", autoCover: true })).status, 200);
  const d = await call<CourseDetail>("GET", `/courses/${id}`, token);
  const thumb = "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg";
  assert.equal(d.data.coverUrl, thumb, "沒上傳 EDM／封面＝用 YouTube 縮圖");
  assert.equal(d.data.edmUrl, thumb);
  assert.equal(d.data.lessons[0]!.coverUrl, thumb);
  assert.equal(d.data.lessons[0]!.autoCover, false);
  // 「單元」檢視的索引：章節沒有自己的封面時 coverUrl 留空（畫面改用課程手動上傳的封面），YouTube 縮圖另外放在 ytThumb 當最後備案（業主 2026-11-17）。
  await call("PATCH", `/admin/courses/${id}`, token, { status: "published" });
  const idx = (await call<{ lessons: { id: string; coverUrl: string | null; ytThumb: string | null }[] }>("GET", "/search-index", token)).data.lessons.find((x) => x.id === lessonId)!;
  assert.equal(idx.coverUrl, null, "不可用 YouTube 縮圖蓋掉課程手動上傳的封面");
  assert.equal(idx.ytThumb, thumb);
});
