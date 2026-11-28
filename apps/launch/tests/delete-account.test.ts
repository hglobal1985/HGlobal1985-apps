import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import { setCentralFetch } from "../src/central.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

const ISS = "https://id.hglobal1985.com";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
function token(sub: string) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: "RS256", typ: "at+jwt", kid: "k1" });
  const p = b64({ iss: ISS, aud: ISS, app_id: "learn", sub, exp: now + 600 });
  return `${h}.${p}.${createSign("RSA-SHA256").update(`${h}.${p}`).sign(privateKey).toString("base64url")}`;
}

test("App 內刪除帳號：中央成功才清本 App 資料；中央拒絕就完全不動並帶回白話原因（中央串接指令 2026-11-28.3）", async () => {
  let central: { status: number; body: unknown } = { status: 200, body: { deleted: true } };
  const seen: { auth: string | null; body: unknown }[] = [];
  setCentralFetch(async (url, init) => {
    const ok = (b: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(b), { status }));
    if (url.endsWith("/oauth/jwks")) return ok({ keys: [jwk] });
    if (url.endsWith("/v1/me/delete-account")) {
      seen.push({ auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body ?? "{}")) });
      return ok(central.body, central.status);
    }
    if (url.endsWith("/v1/me/amway")) return ok({ enabled: false, fields: {} });
    if (url.endsWith("/v1/me/profile")) return ok({ fields: { display_name: { value: "新會員" } } });
    if (url.endsWith("/v1/eligibility/context")) return ok({ member_id: "m_del", roles: [], hglobal_verified: false, center: null });
    return ok({}, 404);
  });
  const db = createTestDb();
  const env: Env = { DB: db };
  const call = async (body: unknown) => {
    const res = await handleApi(new Request("https://learn.test/api/v2/me/delete-account", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token("m_del")}` }, body: JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as { ok?: boolean; error?: { code: string; message: string } } };
  };
  const rows = async () => (await db.prepare("SELECT COUNT(*) AS n FROM feature_uses WHERE member_sub = 'm_del'").first<{ n: number }>())!.n;
  await db.prepare("INSERT INTO feature_uses (member_sub, feature) VALUES ('m_del', 'profile_edit')").run();
  assert.equal(await rows(), 1);

  // 中央拒絕（最後一位超級管理員）：原因原樣帶回、資料不動
  central = { status: 409, body: { error: { code: "last_super_admin", message: "你是最後一位超級管理員，請先把職務移交給別人" } } };
  const blocked = await call({});
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error?.message, "你是最後一位超級管理員，請先把職務移交給別人");
  assert.equal(await rows(), 1);

  // 中央回 401：轉成 422（不要讓 App 當成登入過期去換發重試）
  central = { status: 401, body: { error: { code: "unauthenticated", message: "請先登入" } } };
  const expired = await call({});
  assert.equal(expired.status, 422);
  assert.equal(await rows(), 1);

  // 成功：本 App 資料清空；有帶會員自己的 Token（不帶 reauth_token）
  central = { status: 200, body: { deleted: true } };
  const done = await call({});
  assert.deepEqual(done.data, { ok: true });
  assert.equal(await rows(), 0);
  assert.ok(seen.at(-1)?.auth?.startsWith("Bearer "));
  assert.deepEqual(seen.at(-1)?.body, {}); // 不再帶 reauth_token（2026-11-28.3）
});
