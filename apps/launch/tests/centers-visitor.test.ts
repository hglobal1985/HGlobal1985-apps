import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("中心清單：沒登入的訪客讀最近一次成功的副本（沒有副本回 503 而不是空白）；登入者不受影響", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = unknown,>(path: string, token?: string) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async () => {
    const res = await handleApi(new Request("https://learn.test/api/v2/auth/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sub: "demo-student" }) }), env);
    return ((await res.json()) as { token: string }).token;
  };
  assert.equal((await call("/centers")).status, 503, "還沒有任何副本：訪客得到明確的錯誤");
  const mine = await call<string[]>("/centers", await login());
  assert.deepEqual(mine.data, ["台北中心", "台中中心", "高雄中心"], "測試帳號固定三個中心");
  // 模擬中央回傳過清單、已存成副本
  await env.DB.prepare("INSERT INTO central_snapshots (key, value) VALUES ('centers', ?)").bind(JSON.stringify(["自強 061", "新竹 122"])).run();
  const v = await call<string[]>("/centers");
  assert.equal(v.status, 200);
  assert.deepEqual(v.data, ["自強 061", "新竹 122"], "訪客看到最近一次成功的中央清單");
});
