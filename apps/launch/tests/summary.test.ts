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

test("總結章節的名稱固定是「總結」（勾選當下與之後修改都強制）；分享者姓名建議取本系統用過的名字（只有管理者）", async () => {
  const { call } = setup();
  const token = (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub: "demo-admin" })).data.token;
  const student = (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub: "demo-student" })).data.token;
  const made = await call<CourseDetail>("POST", "/admin/courses", token, { title: "名稱測試", teacher: "課程主講", hostUnit: "寰宇總部", status: "published" });
  const id = made.data.id;
  const l1 = made.data.lessons[0]!.id;
  const created = await call<CourseDetail>("POST", `/admin/courses/${id}/lessons`, token, { title: "亂填的名稱", sharer: "李華", isSummary: true });
  const sum = created.data.lessons.find((l) => l.isSummary)!;
  assert.equal(sum.title, "總結", "新增時勾總結 → 名稱是總結（不管填了什麼）");
  await call("PATCH", `/admin/lessons/${l1}`, token, { title: "第一堂", sharer: "李華" });
  await call("PATCH", `/admin/lessons/${l1}`, token, { isSummary: true, title: "又亂填" });
  const after = (await call<CourseDetail>("GET", `/courses/${id}`, token)).data.lessons;
  assert.equal(after.find((l) => l.id === l1)!.title, "總結", "編輯時勾總結 → 名稱改成總結");
  assert.equal(after.find((l) => l.id === sum.id)!.title, "總結", "原本那堂雖然被轉移，名稱保留總結可再改");
  await call("PATCH", `/admin/lessons/${l1}`, token, { title: "想改名" });
  assert.equal((await call<CourseDetail>("GET", `/courses/${id}`, token)).data.lessons.find((l) => l.id === l1)!.title, "總結", "還是總結章節時，改名無效");
  await call("PATCH", `/admin/lessons/${l1}`, token, { isSummary: false, title: "取消後可改名" });
  assert.equal((await call<CourseDetail>("GET", `/courses/${id}`, token)).data.lessons.find((l) => l.id === l1)!.title, "取消後可改名");

  const names = await call<string[]>("GET", "/admin/sharer-names?q=", token);
  assert.deepEqual([names.data.includes("李華"), names.data.includes("課程主講")], [true, true], "分享者與主講人姓名都會建議");
  assert.deepEqual((await call<string[]>("GET", "/admin/sharer-names?q=" + encodeURIComponent("李"), token)).data, ["李華"], "輸入一個字就篩選");
  assert.equal((await call("GET", "/admin/sharer-names?q=", student)).status, 403, "學員不能用");
});
