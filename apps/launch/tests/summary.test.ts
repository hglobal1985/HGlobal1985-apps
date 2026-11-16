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

test("總結與銷售課程：每門課最多一堂（勾新的自動轉移）、與主講人互斥、教材不能勾、複製不帶標記、搜尋索引帶 isSummary", async () => {
  const { call } = setup();
  const token = (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub: "demo-admin" })).data.token;
  const made = await call<CourseDetail>("POST", "/admin/courses", token, { title: "總結測試", hostUnit: "寰宇總部", status: "published" });
  const id = made.data.id;
  const l1 = made.data.lessons[0]!.id;
  const l2 = (await call<CourseDetail>("POST", `/admin/courses/${id}/lessons`, token, { title: "第二堂", isSummary: true })).data.lessons.find((l) => l.isSummary)!.id;
  const flags = async () => (await call<CourseDetail>("GET", `/courses/${id}`, token)).data.lessons;
  const summaries = async () => (await flags()).filter((l) => l.isSummary).map((l) => l.id);
  const speakers = async () => (await flags()).filter((l) => l.isSpeaker).map((l) => l.id);
  assert.deepEqual(await summaries(), [l2], "新增章節時勾總結與銷售課程");

  assert.equal((await call("PATCH", `/admin/lessons/${l1}`, token, { isSummary: true })).status, 200);
  assert.deepEqual(await summaries(), [l1], "勾第一堂＝轉移，第二堂自動取消");

  // 與主講人互斥：勾主講人 → 本堂的總結自動取消；再勾總結 → 主講人自動取消
  await call("PATCH", `/admin/lessons/${l1}`, token, { isSpeaker: true });
  assert.deepEqual([await speakers(), await summaries()], [[l1], []], "勾主講人，總結自動取消");
  await call("PATCH", `/admin/lessons/${l1}`, token, { isSummary: true });
  assert.deepEqual([await speakers(), await summaries()], [[], [l1]], "勾總結，主講人自動取消");
  assert.equal((await call("PATCH", `/admin/lessons/${l1}`, token, { isSpeaker: true, isSummary: true })).status, 400, "同時勾兩個直接擋掉");
  assert.equal((await call("POST", `/admin/courses/${id}/lessons`, token, { title: "兩個都勾", isSpeaker: true, isSummary: true })).status, 400);
  // 不同堂：一堂主講、另一堂總結可以並存
  await call("PATCH", `/admin/lessons/${l2}`, token, { isSpeaker: true });
  assert.deepEqual([await speakers(), await summaries()], [[l2], [l1]], "不同堂可並存");

  const mat = (await call<CourseDetail>("POST", `/admin/courses/${id}/lessons`, token, { title: "講義", kind: "material" })).data.lessons.find((l) => l.title === "講義")!.id;
  assert.equal((await call("PATCH", `/admin/lessons/${mat}`, token, { isSummary: true })).status, 400, "教材不能勾");

  await call("POST", `/admin/lessons/${l1}/duplicate`, token);
  assert.deepEqual(await summaries(), [l1], "複製的那堂不帶標記");
  await call("PATCH", `/admin/lessons/${l1}`, token, { isSummary: false });
  assert.deepEqual(await summaries(), [], "可以全部不勾");
  await call("PATCH", `/admin/lessons/${l1}`, token, { isSummary: true });
  const idx = (await call<{ lessons: { id: string; isSummary: boolean }[] }>("GET", "/search-index", token)).data.lessons.filter((l) => l.isSummary).map((l) => l.id);
  assert.deepEqual(idx, [l1]);
});
