import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { createWorker } from "../src/worker.ts";
import { createTestDb } from "./sqlite-d1.ts";

const html = '<!doctype html><html><head><title>寰宇行動大學</title></head><body><div id="root"></div></body></html>';
const files = { "/index.html": { type: "text/html; charset=utf-8", data: btoa(unescape(encodeURIComponent(html))) } };

test("教育中心自訂名稱：權限、讀取、還原預設、分享標題同步", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub })).data.token;
  const admin = await login("demo-admin");
  const president = await login("demo-president"); // 台北中心會長
  const student = await login("demo-student");

  assert.equal((await call("PUT", "/admin/center-name?center=台北中心", student, { name: "亂改" })).status, 403);
  assert.equal((await call("PUT", "/admin/center-name?center=台中中心", president, { name: "別人家" })).status, 403);
  assert.equal((await call("PUT", "/admin/center-name?center=台北中心", president, { name: "大台北教育中心" })).status, 200);
  assert.deepEqual((await call<Record<string, string>>("GET", "/center-names", student)).data, { 台北中心: "大台北教育中心" });
  // 分享預覽標題用自訂名稱
  await env.DB.prepare("INSERT INTO short_links (slug, kind, value) VALUES ('tp', 'center', '台北中心')").run();
  const w = createWorker(files);
  assert.match(await (await w.fetch(new Request("https://learn.test/tp"), env)).text(), /property="og:title" content="大台北教育中心 \| 寰宇行動大學"/);
  // 英文縮寫網址只有最高權限管理員能改（中心會長也不行）
  assert.equal((await call("PUT", "/admin/short-links", president, { kind: "center", value: "台北中心", slug: "tpe" })).status, 403);
  // 總部可以改任何中心；空白＝還原預設
  assert.equal((await call("PUT", "/admin/center-name?center=台中中心", admin, { name: "中部教育中心" })).status, 200);
  assert.equal((await call("PUT", "/admin/center-name?center=台北中心", admin, { name: "  " })).status, 200);
  assert.deepEqual((await call<Record<string, string>>("GET", "/center-names", student)).data, { 台中中心: "中部教育中心" });
  assert.match(await (await w.fetch(new Request("https://learn.test/tp"), env)).text(), /property="og:title" content="台北教育中心 \| 寰宇行動大學"/);
});
