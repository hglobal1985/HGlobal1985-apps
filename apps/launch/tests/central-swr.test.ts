import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import { setCentralFetch } from "../src/central.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

// 業主 2026-11-20：向中央讀資料「先給舊的、背景更新」＋獎銜定義只問一次＋Server-Timing 記錄中央呼叫。
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
const ISS = "https://id.hglobal1985.com";
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const token = (sub: string) => {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: "RS256", typ: "at+jwt", kid: "k1" });
  const p = b64({ iss: ISS, aud: ISS, app_id: "learn", sub, exp: now + 3600 });
  return `${h}.${p}.${createSign("RSA-SHA256").update(`${h}.${p}`).sign(privateKey).toString("base64url")}`;
};

test("獎銜定義全站只問一次；回應帶中央呼叫計時；職務過期後先給舊資料、背景更新（最長 5 分鐘）", async () => {
  const calls: Record<string, number> = {};
  let roles: string[] = [];
  let slow: Promise<void> | null = null;
  setCentralFetch(async (url) => {
    const path = url.replace(ISS, "").split("?")[0];
    calls[path] = (calls[path] ?? 0) + 1;
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (path === "/oauth/jwks") return ok({ keys: [jwk] });
    if (path === "/v1/eligibility/context") {
      if (slow) await slow;
      return ok({ member_id: "m_swr", roles: roles.map((role) => ({ role })), hglobal_verified: true, center: null });
    }
    if (path === "/v1/me/profile") return ok({ fields: { display_name: { value: "會員" } } });
    if (path === "/v1/me/amway") return ok({ enabled: true, fields: { education_system: { value: "寰宇" }, education_center: { value: "台北 100" }, rank: { value: "gold" } } });
    if (path === "/v1/amway/field-definitions") return ok([{ key: "rank", options: [{ value: "gold", label: "金牌", badge_url: null, badge: null }] }]);
    if (path.startsWith("/v1/vocab")) return ok({ suggestions: [] });
    return new Response("{}", { status: 404 });
  });
  const env: Env = { DB: createTestDb() };
  const waits: Promise<unknown>[] = [];
  const exec = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
  const get = (path: string) => handleApi(new Request(`https://learn.test/api/v2${path}`, { headers: { authorization: `Bearer ${token("m_swr")}` } }), env, exec);

  const first = await get("/me?fresh=1");
  assert.equal(first.status, 200);
  assert.equal(calls["/v1/amway/field-definitions"], 1, "獎銜名稱、選項、徽章共用同一次查詢");
  assert.match(first.headers.get("server-timing") ?? "", /central\d;desc="\/v1\//);

  await get("/me"); // fresh=1 會清掉快取；再來一次把快取暖起來
  // 超過 60 秒（職務快取過期）：中央變慢、而且職務已改；這次要立刻回應（舊資料），不能卡住等中央。
  const realNow = Date.now;
  Date.now = () => realNow() + 90_000;
  try {
    let release!: () => void;
    slow = new Promise<void>((r) => (release = r));
    roles = ["super_admin"];
    const t0 = realNow();
    const stale = await get("/me");
    assert.equal(stale.status, 200);
    assert.ok(realNow() - t0 < 2000, "先給舊資料，不等中央");
    assert.equal(((await stale.json()) as { member: { role: string } }).member.role, "student"); // 還是舊的職務
    release();
    await Promise.all(waits);
    const fresh = await get("/me");
    assert.equal(((await fresh.json()) as { member: { role: string } }).member.role, "admin"); // 背景更新後拿到新職務
  } finally {
    Date.now = realNow;
  }
});

test("同時查同一份資料：先開始的那個請求被取消（查詢失敗）時，等它的請求自己再查一次，不會回 500（2026-11-21 修正）", async () => {
  const { cached } = await import("../src/central.ts");
  let n = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const first = cached("t:shared", 60_000, async () => {
    n++;
    await gate;
    throw new Error("request canceled"); // 模擬：發起查詢的請求被瀏覽器取消，連線一起中斷
  });
  const second = cached("t:shared", 60_000, async () => {
    n++;
    return "fresh";
  });
  release();
  await assert.rejects(first);
  assert.equal(await second, "fresh");
  assert.equal(n, 2);
});
