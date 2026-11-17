import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("中心頁瀏覽計數：每進入一次就 +1（同一人也算）、訪客也算、可讀總數", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub })).data.token;
  const [a, b] = await Promise.all([login("demo-student"), login("demo-silver")]);
  assert.equal((await call("POST", "/center-views", undefined, { center: "南京 062" })).status, 200); // 訪客也算（業主 2026-11-17）
  assert.equal((await call<{ total: number }>("POST", "/center-views", a, { center: "南京 062" })).data.total, 690, "前面訪客那一次也算");
  assert.equal((await call<{ total: number }>("POST", "/center-views", a, { center: "南京  062" })).data.total, 691, "同一人再進入也 +1（名稱空白不同也算同一個中心）");
  assert.equal((await call<{ total: number }>("POST", "/center-views", b, { center: "南京 062" })).data.total, 692);
  assert.equal((await call<{ total: number }>("POST", "/center-views", b, { center: "台北中心" })).data.total, 689, "不同中心各自計數");
  assert.equal((await call<{ total: number }>("GET", "/center-views?center=南京 062", a)).data.total, 692);
});
