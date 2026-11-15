import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

function setup() {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  return { call };
}

test("主講人章節：同一門課最多一堂（勾新的自動轉移）、教材不能勾；搜尋索引帶 isSpeaker", async () => {
  const { call } = setup();
  const token = (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub: "demo-admin" })).data.token;
  const made = await call<CourseDetail>("POST", "/admin/courses", token, { title: "主講人測試", hostUnit: "寰宇總部", status: "published" });
  const id = made.data.id;
  const l1 = made.data.lessons[0]!.id;
  const l2 = (await call<CourseDetail>("POST", `/admin/courses/${id}/lessons`, token, { title: "第二堂", isSpeaker: true })).data.lessons.find((l) => l.title === "第二堂")!.id;
  const speakers = async () => (await call<CourseDetail>("GET", `/courses/${id}`, token)).data.lessons.filter((l) => l.isSpeaker).map((l) => l.id);
  assert.deepEqual(await speakers(), [l2], "新增章節時勾主講人");
  assert.equal((await call("PATCH", `/admin/lessons/${l1}`, token, { isSpeaker: true })).status, 200);
  assert.deepEqual(await speakers(), [l1], "勾第一堂＝轉移，第二堂自動取消");
  await call("PATCH", `/admin/lessons/${l1}`, token, { isSpeaker: false });
  assert.deepEqual(await speakers(), [], "可以全部不勾");
  const mat = (await call<CourseDetail>("POST", `/admin/courses/${id}/lessons`, token, { title: "講義", kind: "material" })).data.lessons.find((l) => l.title === "講義")!.id;
  assert.equal((await call("PATCH", `/admin/lessons/${mat}`, token, { isSpeaker: true })).status, 400, "教材不能當主講人");
  await call("PATCH", `/admin/lessons/${l2}`, token, { isSpeaker: true });
  const idx = (await call<{ lessons: { id: string; isSpeaker: boolean }[] }>("GET", "/search-index", token)).data.lessons.filter((l) => l.isSpeaker).map((l) => l.id);
  assert.deepEqual(idx, [l2]);
});

test("章節日期預設跟著課程日期：沒設定的章節日期＝課程日期，課程日期改了章節跟著變；自己設定的不動", async () => {
  const { call } = setup();
  const token = (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub: "demo-admin" })).data.token;
  const made = await call<CourseDetail>("POST", "/admin/courses", token, { title: "日期測試", hostUnit: "寰宇總部", eventStart: "2026-12-01" });
  const id = made.data.id;
  const a = (await call<CourseDetail>("POST", `/admin/courses/${id}/lessons`, token, { title: "跟著" })).data.lessons.find((l) => l.title === "跟著")!;
  const b = (await call<CourseDetail>("POST", `/admin/courses/${id}/lessons`, token, { title: "自訂", eventDate: "2026-12-05" })).data.lessons.find((l) => l.title === "自訂")!;
  assert.deepEqual([a.dateFollows, a.eventDate], [true, "2026-12-01"]);
  assert.deepEqual([b.dateFollows, b.eventDate], [false, "2026-12-05"]);
  await call("PATCH", `/admin/courses/${id}`, token, { eventStart: "2026-12-10" });
  const d = (await call<CourseDetail>("GET", `/courses/${id}`, token)).data.lessons;
  assert.equal(d.find((l) => l.id === a.id)!.eventDate, "2026-12-10", "跟著課程日期變");
  assert.equal(d.find((l) => l.id === b.id)!.eventDate, "2026-12-05", "自己設定的不變");
});
