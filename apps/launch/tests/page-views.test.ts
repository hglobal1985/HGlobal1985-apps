import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("點閱：訪客也算、重新整理也 +1；從課程連結進入算進主辦中心與系列", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const admin = (await call<{ token: string }>("POST", "/auth/demo", { body: { sub: "demo-admin" } })).data.token;
  const made = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "點閱課", teacher: "王小明", status: "published", hostUnit: "台北中心", series: "點閱系列", priceTwd: 0 } })).data;
  // 訪客（沒登入）進入課程頁：中心與系列各 +1，重複進入再 +1
  assert.equal((await call("POST", "/course-views", { body: { courseId: made.id } })).status, 200);
  await call("POST", "/course-views", { body: { courseId: made.id } });
  assert.equal((await call<{ total: number }>("POST", "/center-views", { body: { center: "台北中心" } })).data.total, 688 + 3, "課程 2 次＋中心頁 1 次（中心點閱另加 688）");
  assert.equal((await call<{ total: number }>("POST", "/series-views", { body: { series: "點閱系列" } })).data.total, 688 + 3);
  // 不存在的課程不計數、也不報錯
  assert.equal((await call<{ ok: boolean }>("POST", "/course-views", { body: { courseId: "nope" } })).data.ok, false);
});
