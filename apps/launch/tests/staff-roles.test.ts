import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import { setCentralFetch } from "../src/central.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

// 業主 2026-11-21：App 內指派職務（中央串接指令 2026-11-21.1）。
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

test("查人、指派：用本人 Token；q 要 2～30 字；任何非 200 都當沒有權限；不寫日誌", async () => {
  const seen: { url: string; method: string; auth: string; body: string }[] = [];
  let allowed = true;
  setCentralFetch(async (url, init) => {
    const path = url.replace(ISS, "");
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (path === "/oauth/jwks") return ok({ keys: [jwk] });
    if (path.startsWith("/v1/eligibility/staff")) {
      seen.push({ url: path, method: init?.method ?? "GET", auth: String((init?.headers as Record<string, string>)?.authorization ?? ""), body: String(init?.body ?? "") });
      if (!allowed) return ok({ error: { code: "forbidden" } }, 403);
      if ((init?.method ?? "GET") === "PUT") return ok({ member_id: "m_x", roles: ["center_president"] });
      return ok({ members: [{ member_id: "m_x", display_name: "王小明", center: "新竹中心 122", roles: ["center_president"] }], assignable_roles: [{ value: "center_president", label: "會長" }, "center_av"] });
    }
    if (path === "/v1/eligibility/context") return ok({ member_id: "m_boss", roles: [], hglobal_verified: true, center: null });
    return new Response("{}", { status: 404 });
  });
  const env: Env = { DB: createTestDb() };
  const t = token("m_boss");
  const call = (method: string, path: string, body?: unknown) => handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { authorization: `Bearer ${t}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);

  const access = await call("GET", "/staff-roles/access");
  assert.deepEqual(await access.json(), { available: true, assignable: [{ value: "center_president", label: "會長" }, { value: "center_av", label: "center_av" }] });

  assert.equal((await call("GET", "/staff-roles?q=a")).status, 422); // 太短
  assert.equal((await call("GET", `/staff-roles?q=${"字".repeat(31)}`)).status, 422); // 太長
  const found = await call("GET", `/staff-roles?q=${encodeURIComponent("小明")}`);
  const body = (await found.json()) as { members: { memberId: string; name: string; center: string; roles: string[] }[] };
  assert.deepEqual(body.members, [{ memberId: "m_x", name: "王小明", center: "新竹中心 122", roles: ["center_president"] }]);
  assert.ok(seen.every((s) => s.auth === `Bearer ${t}`), "一律用呼叫者本人的 Token");

  const put = await call("PUT", "/staff-roles/m_x", { roles: ["center_president", "center_president"] });
  assert.equal(put.status, 200);
  assert.deepEqual(await put.json(), { roles: ["center_president"] });
  const sent = seen.find((s) => s.method === "PUT")!;
  assert.equal(sent.url, "/v1/eligibility/staff/m_x");
  assert.deepEqual(JSON.parse(sent.body), { roles: ["center_president"] }); // 事後完整清單（去重）
  assert.equal((await call("PUT", "/staff-roles/m_x", { roles: "x" })).status, 422);

  allowed = false; // 中央回 403＝沒有權限：入口不顯示、查人與指派都被擋
  assert.deepEqual(await (await call("GET", "/staff-roles/access")).json(), { available: false, assignable: [] });
  assert.equal((await call("GET", "/staff-roles")).status, 403);
  assert.equal((await call("PUT", "/staff-roles/m_x", { roles: [] })).status, 403);
});
