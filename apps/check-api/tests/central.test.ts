import assert from "node:assert/strict";
import { test } from "node:test";
import { setCentralFetch, verifyAccessToken, verifyWebhook } from "../src/central.ts";

const b64url = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");

test("Access Token：驗 RS256、typ、iss/aud、app_id、exp", async () => {
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1", use: "sig", alg: "RS256" };
  setCentralFetch(async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } }));
  const sign = async (claims: Record<string, unknown>, typ = "at+jwt") => {
    const h = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ, kid: "k1" })));
    const p = b64url(new TextEncoder().encode(JSON.stringify(claims)));
    const s = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64url(s)}`;
  };
  const base = { sub: "m1", iss: "https://id.hglobal1985.com", aud: "https://id.hglobal1985.com", app_id: "check", exp: Math.floor(Date.now() / 1000) + 600 };
  assert.equal(await verifyAccessToken(await sign(base)), "m1");
  assert.equal(await verifyAccessToken(await sign({ ...base, app_id: "learn" })), null, "別的 App 的 Token");
  assert.equal(await verifyAccessToken(await sign({ ...base, exp: 1 })), null, "過期");
  assert.equal(await verifyAccessToken(await sign(base, "JWT")), null, "typ 不對");
  assert.equal(await verifyAccessToken(await sign({ ...base, iss: "https://evil.test" })), null);
});

test("webhook 簽章：正確、錯誤、超過 5 分鐘", async () => {
  const secret = "s3cret";
  const raw = '{"id":"e1","type":"member.deleted","member_id":"m1"}';
  const ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = "v1=" + Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${raw}`))).toString("hex");
  assert.equal(await verifyWebhook(secret, ts, sig, raw), true);
  assert.equal(await verifyWebhook(secret, ts, sig, raw + " "), false);
  assert.equal(await verifyWebhook(secret, String(Number(ts) - 600), sig, raw), false);
});
