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

test("其他教材：不計入章節堂數；序號各自從 1；各自排序；複製一堂", async () => {
  const { call } = setup();
  const token = (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub: "demo-admin" })).data.token;
  const made = await call<CourseDetail>("POST", "/admin/courses", token, { title: "教材測試", hostUnit: "寰宇總部" });
  const id = made.data.id;
  // 章節 2 堂（建立時已有第 1 堂）＋教材 2 份
  await call("POST", `/admin/courses/${id}/lessons`, token, { title: "第二堂" });
  await call("POST", `/admin/courses/${id}/lessons`, token, { title: "講義 A", kind: "material" });
  const d = await call<CourseDetail>("POST", `/admin/courses/${id}/lessons`, token, { title: "講義 B", kind: "material" });
  assert.equal(d.status, 200);
  assert.equal(d.data.lessonCount, 2); // 教材不計入
  const chapters = d.data.lessons.filter((l) => !l.material && !l.full);
  const materials = d.data.lessons.filter((l) => l.material);
  assert.deepEqual(chapters.map((l) => l.position), [1, 2]);
  assert.deepEqual(materials.map((l) => [l.title, l.position]), [["講義 A", 1], ["講義 B", 2]]);
  // 教材各自排序：B 排前面，章節不動
  const re = await call<CourseDetail>("POST", `/admin/courses/${id}/lessons/order`, token, { ids: [materials[1]!.id, materials[0]!.id] });
  assert.deepEqual(re.data.lessons.filter((l) => l.material).map((l) => l.title), ["講義 B", "講義 A"]);
  assert.deepEqual(re.data.lessons.filter((l) => !l.material && !l.full).map((l) => l.title), ["第 1 堂", "第二堂"]);
  // 傳錯組（章節 id 混教材 id）會被擋
  const bad = await call("POST", `/admin/courses/${id}/lessons/order`, token, { ids: [chapters[0]!.id, materials[0]!.id] });
  assert.equal(bad.status, 400);
  // 複製章節：放在原本那堂後面、章節堂數 +1
  const cp = await call<CourseDetail>("POST", `/admin/lessons/${chapters[0]!.id}/duplicate`, token);
  assert.equal(cp.status, 200);
  assert.equal(cp.data.lessonCount, 3);
  assert.deepEqual(cp.data.lessons.filter((l) => !l.material && !l.full).map((l) => l.title), ["第 1 堂", "第 1 堂（複製）", "第二堂"]);
  // 複製教材：不增加章節堂數
  const cm = await call<CourseDetail>("POST", `/admin/lessons/${materials[0]!.id}/duplicate`, token);
  assert.equal(cm.data.lessonCount, 3);
  assert.equal(cm.data.lessons.filter((l) => l.material).length, 3);
});
