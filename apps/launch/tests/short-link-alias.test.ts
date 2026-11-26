import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

function setup() {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub })).data.token;
  return { call, login };
}

test("短網址改名後，舊縮寫仍然有效（杜杜龍 2026-11-26）；清除才真的失效；別人不能佔用舊縮寫", async () => {
  const { call, login } = setup();
  const admin = await login("demo-admin");
  const set = (slug: string, value = "白金會") => call("PUT", "/admin/short-links", admin, { kind: "series", value, slug });
  await call("POST", "/admin/keywords", admin, { kind: "series", value: "白金會" }).catch(() => undefined);
  await call("POST", "/admin/keywords", admin, { kind: "series", value: "別的系列" }).catch(() => undefined);
  assert.equal((await set("old1")).status, 200);
  assert.equal((await call<{ value: string }>("GET", "/short-links/old1")).data.value, "白金會");
  assert.equal((await set("new1")).status, 200);
  assert.equal((await call<{ value: string }>("GET", "/short-links/new1")).data.value, "白金會");
  assert.equal((await call<{ value: string }>("GET", "/short-links/old1")).data.value, "白金會", "舊縮寫仍然打得開");
  assert.equal((await set("old1", "別的系列")).status, 409, "舊縮寫被保留，不能給別的項目");
  assert.equal((await set("old1")).status, 200, "改回舊縮寫可以");
  assert.equal((await call<{ value: string }>("GET", "/short-links/new1")).data.value, "白金會", "剛換掉的 new1 變成別名，也仍然有效");
  await call("POST", "/admin/short-links/remove", admin, { kind: "series", value: "白金會" });
  assert.equal((await call("GET", "/short-links/old1")).status, 404, "清除＝全部失效");
  assert.equal((await call("GET", "/short-links/new1")).status, 404);
});
