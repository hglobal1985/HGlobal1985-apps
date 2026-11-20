import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("教材卡只剩一種：沒章節、免費、沒日期＝純教材（不能報名）；任何卡都能貼 YouTube 在 App 內播放；加章節或日期就變一般課程", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub })).data.token;
  const admin = await login("demo-admin");

  // 新增只有一種（不帶 isList）：一開始沒章節、免費、沒日期＝純教材
  const made = await call<CourseDetail>("POST", "/admin/courses", admin, { title: "會長翡翠鑽石會議", noSpeaker: true });
  assert.equal(made.status, 200);
  const id = made.data.id;
  await env.DB.prepare("DELETE FROM lessons WHERE course_id = ?").bind(id).run(); // 測試資料庫有個觸發器會自動塞第 1 堂（正式站沒有）；先清掉
  made.data.isList = (await call<CourseDetail>("GET", `/courses/${id}`, admin)).data.isList;
  assert.equal(made.data.isList, true, "沒章節、免費、沒日期＝純教材");
  await call("PATCH", `/admin/courses/${id}`, admin, { status: "published" });

  // 任何教材卡貼 YouTube 都在 App 內播放（存成影片來源）
  const v = await call<CourseDetail>("POST", `/admin/courses/${id}/materials`, admin, { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "10月" });
  const video = v.data.lessons.find((l) => l.title === "10月")!;
  assert.equal(video.linkUrl, undefined);
  assert.deepEqual(video.media, { type: "youtube", ref: "dQw4w9WgXcQ" });

  // 加上章節：就變成一般課程的規則
  assert.equal((await call("POST", `/admin/courses/${id}/lessons`, admin, { title: "第 1 堂" })).status, 200, "教材卡可以新增章節");
  assert.equal((await call<CourseDetail>("GET", `/courses/${id}`, admin)).data.isList, false, "有章節＝一般課程");
  // 完整版課程影片也開放
  assert.equal((await call("POST", `/admin/courses/${id}/full-version`, admin)).status, 200);

  // 沒章節但有日期＝一般課程（例如線下活動，可以報名）
  const ev = await call<CourseDetail>("POST", "/admin/courses", admin, { title: "線下活動", noSpeaker: true, eventStart: "2030-01-01" });
  assert.equal(ev.data.isList, false, "有日期＝一般課程");
});
