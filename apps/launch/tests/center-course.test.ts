import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("中心課程：總部預設否、可勾選；中心音控建立的強制是且不能關閉", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub })).data.token;
  const admin = await login("demo-admin");
  const a = await call<CourseDetail>("POST", "/admin/courses", admin, { title: "總部課", hostUnit: "寰宇總部" });
  assert.equal(a.data.centerCourse, false);
  await call("PATCH", `/admin/courses/${a.data.id}`, admin, { centerCourse: true });
  assert.equal((await call<CourseDetail>("GET", `/courses/${a.data.id}`, admin)).data.centerCourse, true);
  await call("PATCH", `/admin/courses/${a.data.id}`, admin, { centerCourse: false });
  assert.equal((await call<CourseDetail>("GET", `/courses/${a.data.id}`, admin)).data.centerCourse, false);

  const president = await login("demo-president");
  const b = await call<CourseDetail>("POST", "/admin/courses", president, { title: "中心課" });
  assert.equal(b.status, 200);
  assert.equal(b.data.centerCourse, true);
  await call("PATCH", `/admin/courses/${b.data.id}`, president, { centerCourse: false });
  assert.equal((await call<CourseDetail>("GET", `/courses/${b.data.id}`, president)).data.centerCourse, true);
});
