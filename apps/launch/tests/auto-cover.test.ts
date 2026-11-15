import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("YouTube 章節：沒有封面時自動用影片縮圖；勾「自動抓取」時一律用縮圖", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const token = (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub: "demo-admin" })).data.token;
  const made = await call<CourseDetail>("POST", "/admin/courses", token, { title: "縮圖測試", hostUnit: "寰宇總部" });
  assert.equal(made.status, 200);
  const id = made.data.id;
  // 沒有任何 YouTube 章節：沒有封面
  assert.equal(made.data.coverUrl, null);
  const lessonId = made.data.lessons[0]!.id;
  const set = await call("PATCH", `/admin/lessons/${lessonId}`, token, { mediaType: "youtube", mediaRef: "https://youtu.be/dQw4w9WgXcQ", autoCover: false });
  assert.equal(set.status, 200);
  const d = await call<CourseDetail>("GET", `/courses/${id}`, token);
  const thumb = "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg";
  assert.equal(d.data.coverUrl, thumb);
  assert.equal(d.data.edmUrl, thumb);
  assert.equal(d.data.lessons[0]!.coverUrl, thumb);
  // 勾選：課程與章節都記起來
  await call("PATCH", `/admin/courses/${id}`, token, { autoCover: true });
  await call("PATCH", `/admin/lessons/${lessonId}`, token, { autoCover: true });
  const e = await call<CourseDetail>("GET", `/courses/${id}`, token);
  assert.equal(e.data.autoCover, true);
  assert.equal(e.data.lessons[0]!.autoCover, true);
  assert.equal(e.data.coverUrl, thumb);
});
