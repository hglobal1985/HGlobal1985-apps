import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("課程封面不抓 YouTube 縮圖（課程用標題文字封面）；YouTube 教材沒上傳封面＝用 YouTube 縮圖；新增課程沒有預設章節", async () => {
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
  assert.equal("autoCover" in made.data, false, "自動抓取欄位已移除");
  const withLesson = await call<CourseDetail>("POST", `/admin/courses/${id}/lessons`, token, { title: "第一堂", autoCover: true });
  const lessonId = withLesson.data.lessons[0]!.id;
  assert.equal((await call("PATCH", `/admin/lessons/${lessonId}`, token, { mediaType: "youtube", mediaRef: "https://youtu.be/dQw4w9WgXcQ" })).status, 200);
  const d = await call<CourseDetail>("GET", `/courses/${id}`, token);
  assert.equal(d.data.coverUrl, null, "有 YouTube 章節也不產生封面");
  assert.equal(d.data.edmUrl, null);
  assert.equal(d.data.lessons[0]!.coverUrl, "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg", "YouTube 教材沒上傳封面＝用 YouTube 縮圖（杜杜龍 2026-11-25）");
  assert.equal(d.data.lessons[0]!.coverAuto, true);
  await call("PATCH", `/admin/courses/${id}`, token, { status: "published" });
  const idx = (await call<{ lessons: { id: string; coverUrl: string | null; ytThumb?: string | null }[] }>("GET", "/search-index", token)).data.lessons.find((x) => x.id === lessonId)!;
  assert.equal(idx.coverUrl, "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
  assert.equal("ytThumb" in idx, false);
});
