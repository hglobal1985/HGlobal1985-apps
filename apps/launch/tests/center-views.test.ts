import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("中心頁瀏覽計數：同人同天只算一次、不同人各算、未登入 401、可讀總數", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub })).data.token;
  const [a, b] = await Promise.all([login("demo-student"), login("demo-silver")]);
  assert.equal((await call("POST", "/center-views", undefined, { center: "南京 062" })).status, 401);
  assert.equal((await call<{ total: number }>("POST", "/center-views", a, { center: "南京 062" })).data.total, 1);
  assert.equal((await call<{ total: number }>("POST", "/center-views", a, { center: "南京  062" })).data.total, 1, "同人同天（名稱空白不同也算同一個中心）只算一次");
  assert.equal((await call<{ total: number }>("POST", "/center-views", b, { center: "南京 062" })).data.total, 2);
  assert.equal((await call<{ total: number }>("POST", "/center-views", b, { center: "台北中心" })).data.total, 1, "不同中心各自計數");
  assert.equal((await call<{ total: number }>("GET", "/center-views?center=南京 062", a)).data.total, 2);
});
