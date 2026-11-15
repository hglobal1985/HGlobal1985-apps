import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import { DEFAULT_APP_SETTINGS, type UiConfig } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { normalizeApp } from "../src/ui-config.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("APP 數值設定：數字夾在合理範圍、選項不合法退回預設、缺的欄位補預設", () => {
  assert.deepEqual(normalizeApp(undefined), DEFAULT_APP_SETTINGS);
  const a = normalizeApp({ homeLeftSec: 999, homeRightSec: -3, tickerSec: 0, blurStrength: 2, freshDays: 3.6, rec: { scope: "x", order: "newest", max: 99, hideEnded: true } });
  assert.deepEqual([a.homeLeftSec, a.homeRightSec, a.tickerSec, a.blurStrength, a.freshDays], [60, 0, 2, 4, 4]);
  assert.deepEqual([a.rec.scope, a.rec.order, a.rec.max, a.rec.hideEnded, a.rec.includeHq], ["myCenter", "newest", 50, true, true]);
});

test("APP 數值設定：只有超級管理員能改、可只改部分欄位（其餘保留）、公開讀取", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub })).data.token;
  const [admin, student] = await Promise.all([login("demo-admin"), login("demo-student")]);
  assert.equal((await call("PUT", "/admin/ui-config", student, { app: { homeLeftSec: 9 } })).status, 403);
  const r = await call<UiConfig>("PUT", "/admin/ui-config", admin, { app: { homeLeftSec: 9, rec: { scope: "all" } } });
  assert.equal(r.data.app.homeLeftSec, 9);
  const r2 = await call<UiConfig>("PUT", "/admin/ui-config", admin, { app: { homeRightSec: 0, rec: { max: 5 } } });
  assert.deepEqual([r2.data.app.homeLeftSec, r2.data.app.homeRightSec, r2.data.app.rec.scope, r2.data.app.rec.max], [9, 0, "all", 5], "只改部分欄位，其餘保留");
  assert.equal((await call<UiConfig>("GET", "/ui-config")).data.app.homeLeftSec, 9, "公開讀取（未登入也能抓）");
});
