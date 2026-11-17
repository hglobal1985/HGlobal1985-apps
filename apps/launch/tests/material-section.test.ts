import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("素材的分類區域標題：只有清單能新增、不編號、不算章節、和教材一起排序、可改名刪除", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const admin = (await call<{ token: string }>("POST", "/auth/demo", { body: { sub: "demo-admin" } })).data.token;
  const list = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "素材", isList: true, status: "published" } })).data;
  const normal = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "一般課", teacher: "王小明" } })).data;
  // 一般課程不能新增分類標題（會被當成章節）
  assert.equal((await call("POST", `/admin/courses/${normal.id}/lessons`, { token: admin, body: { kind: "section", title: "x" } })).status, 400);
  let d = (await call<CourseDetail>("POST", `/admin/courses/${list.id}/lessons`, { token: admin, body: { kind: "section", title: "簡報與文件" } })).data;
  d = (await call<CourseDetail>("POST", `/admin/courses/${list.id}/materials`, { token: admin, body: { url: "https://docs.google.com/presentation/d/abc/edit", title: "第一屆簡報" } })).data;
  d = (await call<CourseDetail>("POST", `/admin/courses/${list.id}/lessons`, { token: admin, body: { kind: "section", title: "影片精華" } })).data;
  assert.deepEqual(d.lessons.map((l) => [l.title, !!l.section, l.position]), [["簡報與文件", true, 0], ["第一屆簡報", false, 1], ["影片精華", true, 0]]);
  assert.equal(d.lessons[0]!.material, true);
  // 章節數不含分類標題
  const sum = (await call<{ id: string; lessonCount: number }[]>("GET", "/courses", { token: admin })).data.find((c) => c.id === list.id)!;
  assert.equal(sum.lessonCount, 0);
  // 標題與教材一起排序：把「影片精華」移到最前面
  const ids = d.lessons.map((l) => l.id);
  assert.equal((await call("POST", `/admin/courses/${list.id}/lessons/order?lite=1`, { token: admin, body: { ids: [ids[2], ids[0], ids[1]] } })).status, 200);
  d = (await call<CourseDetail>("GET", `/courses/${list.id}`, { token: admin })).data;
  assert.deepEqual(d.lessons.map((l) => l.title), ["影片精華", "簡報與文件", "第一屆簡報"]);
  // 改名、刪除
  assert.equal((await call("PATCH", `/admin/lessons/${d.lessons[0]!.id}`, { token: admin, body: { title: "影片花絮" } })).status, 200);
  assert.equal((await call("DELETE", `/admin/lessons/${d.lessons[1]!.id}`, { token: admin })).status, 200);
  d = (await call<CourseDetail>("GET", `/courses/${list.id}`, { token: admin })).data;
  assert.deepEqual(d.lessons.map((l) => l.title), ["影片花絮", "第一屆簡報"]);
});
