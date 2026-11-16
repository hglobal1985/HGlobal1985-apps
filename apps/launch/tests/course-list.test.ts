import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail, CourseSummary } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("素材清單：建立時沒有章節、公開免費；YouTube 教材在 App 內播放並計入進度；其他連結開外部；不能新增章節與完整版", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub })).data.token;
  const [admin, student] = await Promise.all([login("demo-admin"), login("demo-student")]);

  const made = await call<CourseDetail>("POST", "/admin/courses", admin, { title: "美力影片清單", isList: true });
  assert.equal(made.status, 200);
  const id = made.data.id;
  assert.equal(made.data.isList, true);
  assert.equal(made.data.isPublic, true, "清單一律完全公開");
  assert.equal(made.data.lessons.length, 0, "清單沒有預設的第 1 堂章節");

  assert.equal((await call("POST", `/admin/courses/${id}/lessons`, admin, { title: "第 1 堂" })).status, 400, "清單不能新增章節");
  assert.equal((await call("POST", `/admin/courses/${id}/full-version`, admin)).status, 400, "清單沒有完整版課程影片");

  const v = await call<CourseDetail>("POST", `/admin/courses/${id}/materials`, admin, { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "走秀花絮" });
  assert.equal(v.status, 200);
  const video = v.data.lessons.find((l) => l.title === "走秀花絮")!;
  assert.equal(video.material, true);
  assert.equal(video.linkUrl, undefined, "YouTube 不存成外部連結");
  assert.deepEqual(video.media, { type: "youtube", ref: "dQw4w9WgXcQ" }, "存成影片來源（App 內播放）");
  const f = await call<CourseDetail>("POST", `/admin/courses/${id}/materials`, admin, { url: "https://docs.google.com/presentation/d/abc/edit", title: "簡報" });
  const file = f.data.lessons.find((l) => l.title === "簡報")!;
  assert.ok(file.linkUrl, "其他連結照常是外部連結");

  await call("PATCH", `/admin/courses/${id}`, admin, { status: "published" });
  const list = (await call<CourseSummary[]>("GET", "/courses", student)).data.find((c) => c.id === id)!;
  assert.equal(list.isList, true);
  assert.equal(list.lessonCount, 1, "影片教材計入堂數（連結不算）");
  assert.equal((await call("POST", `/courses/${id}/lessons/${video.id}/complete`, student)).status, 200);
  const after = (await call<CourseSummary[]>("GET", "/courses", student)).data.find((c) => c.id === id)!;
  assert.equal(after.progressPercent, 100, "看完影片教材＝學習進度 100%");

  // 影片換成一般連結、再換回 YouTube
  const toLink = await call<CourseDetail>("PUT", `/admin/lessons/${video.id}/material`, admin, { url: "https://example.com/a.pdf", title: "改成檔案" });
  const l1 = toLink.data.lessons.find((l) => l.id === video.id)!;
  assert.ok(l1.linkUrl);
  assert.equal(l1.media?.type, "demo");
  const toVideo = await call<CourseDetail>("PUT", `/admin/lessons/${video.id}/material`, admin, { url: "https://youtu.be/dQw4w9WgXcQ", title: "又是影片" });
  const l2 = toVideo.data.lessons.find((l) => l.id === video.id)!;
  assert.equal(l2.linkUrl, undefined);
  assert.equal(l2.media?.ref, "dQw4w9WgXcQ");

  // 一般課程貼 YouTube 仍是外部連結（行為不變）
  const normal = (await call<CourseDetail>("POST", "/admin/courses", admin, { title: "一般課", teacher: "王小明" })).data;
  assert.equal(normal.isList, false);
  const n = await call<CourseDetail>("POST", `/admin/courses/${normal.id}/materials`, admin, { url: "https://youtu.be/dQw4w9WgXcQ", title: "影片連結" });
  assert.ok(n.data.lessons.find((l) => l.title === "影片連結")!.linkUrl);
});
