import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail, CourseSummary } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("素材清單：建立時沒有章節、公開免費；YouTube 教材在 App 內播放（不累積小樹苗與學習進度）；其他連結開外部", async () => {
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
  assert.equal(after.completedLessons, 0, "教材類看完不累積小樹苗（不算已完成章節）");
  // 清單裡的影片不再用 YouTube 縮圖（業主 2026-11-22）：沒上傳封面就是 null。
  await call("PATCH", `/admin/courses/${id}`, admin, { isShorts: true }); // 短影音清單的影片才會出現在「單元」索引
  const idx = (await call<{ lessons: { id: string; coverUrl: string | null }[] }>("GET", "/search-index", student)).data.lessons.find((l) => l.id === video.id)!;
  assert.equal(idx.coverUrl, null);
  assert.equal((await call<CourseDetail>("GET", `/courses/${id}`, student)).data.lessons.find((l) => l.id === video.id)!.coverUrl, null);
  assert.equal(after.progressPercent, 0, "教材類不計學習進度");

  // 影片換成一般連結、再換回 YouTube
  const toLink = await call<CourseDetail>("PUT", `/admin/lessons/${video.id}/material`, admin, { url: "https://example.com/a.pdf", title: "改成檔案" });
  const l1 = toLink.data.lessons.find((l) => l.id === video.id)!;
  assert.ok(l1.linkUrl);
  assert.equal(l1.media?.type, "demo");
  const toVideo = await call<CourseDetail>("PUT", `/admin/lessons/${video.id}/material`, admin, { url: "https://youtu.be/dQw4w9WgXcQ", title: "又是影片" });
  const l2 = toVideo.data.lessons.find((l) => l.id === video.id)!;
  assert.equal(l2.linkUrl, undefined);
  assert.equal(l2.media?.ref, "dQw4w9WgXcQ");

  // 教材卡只剩一種（業主 2026-11-20）：一般課程貼 YouTube 也存成影片來源（App 內播放）
  const normal = (await call<CourseDetail>("POST", "/admin/courses", admin, { title: "一般課", teacher: "王小明" })).data;
  assert.equal(normal.isList, false);
  const n = await call<CourseDetail>("POST", `/admin/courses/${normal.id}/materials`, admin, { url: "https://youtu.be/dQw4w9WgXcQ", title: "影片連結" });
  assert.equal(n.data.lessons.find((l) => l.title === "影片連結")!.media?.ref, "dQw4w9WgXcQ");
});

test("分享文字：素材清單與清單影片各有自己的範本（和課程分開設定），空白退回預設", async () => {
  const { shareMessage, DEFAULT_SHARE_SETTINGS: d } = await import("../src/contract.ts");
  const { normalizeShare } = await import("../src/ui-config.ts");
  const url = "https://learn.test/course/c1";
  assert.equal(shareMessage(d, url, undefined, undefined, undefined, { title: "美力之星" }), `推薦你看「美力之星」，裡面有好多精彩影片，一起來看吧！\n\n${d.linkLead}\n${url}`);
  assert.match(shareMessage(d, `${url}?2`, undefined, undefined, undefined, { title: "美力之星", item: "首爾學習之旅回顧" }), /^我剛看完這段精彩影片「首爾學習之旅回顧」（美力之星）/);
  const s = normalizeShare({ listText: "清單：{清單名稱}", listItemText: " " });
  assert.equal(s.listText, "清單：{清單名稱}");
  assert.equal(s.listItemText, d.listItemText, "空白退回預設");
  assert.equal(shareMessage(s, url, { teacher: "王", title: "課" }), shareMessage(d, url, { teacher: "王", title: "課" }), "課程範本不受清單設定影響");
});
