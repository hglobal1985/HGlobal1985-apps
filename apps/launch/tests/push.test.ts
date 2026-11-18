import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail, Order } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { courseReminders, flushPushes } from "../src/push.ts";
import { createTestDb } from "./sqlite-d1.ts";

const b64u = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");
const unb64u = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

/** 手機端（瀏覽器）解密：RFC 8291 接收方。 */
async function decrypt(body: Uint8Array, uaKeys: CryptoKeyPair, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", uaKeys.publicKey));
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaKeys.privateKey, 256));
  const hk = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) => new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s as BufferSource, info: info as BufferSource }, await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]), len * 8));
  const te = new TextEncoder();
  const ikm = await hk(auth, ecdh, new Uint8Array([...te.encode("WebPush: info\0"), ...uaPublic, ...asPublic]), 32);
  const cek = await hk(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hk(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), cipher));
  assert.equal(plain[plain.length - 1], 2, "最後一個記錄的結尾標記");
  return new TextDecoder().decode(plain.slice(0, -1));
}

test("手機推播：訂閱、站內通知自動推播（加密內容手機解得開、VAPID 簽章正確）、失效裝置自動移除、開課前一天提醒", async () => {
  const vapid = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", vapid.privateKey);
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on", VAPID_PRIVATE_JWK: JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }) };
  const sent: { url: string; headers: Record<string, string>; body: Uint8Array }[] = [];
  let status = 201;
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), headers: Object.fromEntries(Object.entries(init.headers as Record<string, string>)), body: new Uint8Array(init.body as Uint8Array) });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  try {
    const call = async <T = Record<string, unknown>,>(method: string, path: string, token?: string, body?: unknown) => {
      const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
      return { status: res.status, data: (await res.json()) as T };
    };
    const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub })).data.token;
    const [admin, student] = await Promise.all(["demo-admin", "demo-student"].map(login));
    const key = (await call<{ publicKey: string }>("GET", "/push/key")).data.publicKey;
    assert.equal(unb64u(key).length, 65, "公鑰是 65 bytes 未壓縮點");

    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const subBody = { endpoint: "https://push.example.com/send/abc123", keys: { p256dh: b64u(await crypto.subtle.exportKey("raw", ua.publicKey)), auth: b64u(auth) } };
    assert.equal((await call("POST", "/push/subscribe", undefined, subBody)).status, 401);
    assert.equal((await call("POST", "/push/subscribe", student, { ...subBody, keys: { p256dh: "x", auth: "y" } })).status, 400);
    assert.equal((await call("POST", "/push/subscribe", student, subBody)).status, 200);

    // 測試通知 → 自動推播到學員的裝置，內容手機解得開
    assert.equal((await call("POST", "/push/test", student)).status, 200);
    assert.equal(sent.length, 1);
    const p = sent[0]!;
    assert.equal(p.url, subBody.endpoint);
    assert.equal(p.headers["content-encoding"], "aes128gcm");
    const msg = JSON.parse(await decrypt(p.body, ua, auth)) as { title: string; link: string };
    assert.equal(msg.title, "推播測試");
    assert.equal(msg.link, "/notices");
    // VAPID：簽章能用公鑰驗證、aud 是推播服務的網域
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(p.headers.authorization!)!;
    assert.equal(m[4], key);
    const claims = JSON.parse(Buffer.from(m[2]!, "base64url").toString()) as { aud: string; exp: number };
    assert.equal(claims.aud, "https://push.example.com");
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vapid.publicKey, unb64u(m[3]!), new TextEncoder().encode(`${m[1]}.${m[2]}`));
    assert.ok(ok, "VAPID 簽章正確");

    // 已推過的不會重推
    assert.equal(await flushPushes(env), 0);
    // 報名付費課 → 總部管理員的通知：管理員沒開推播就不推；學員自己的「報名已送出」會推
    const paid = (await call<CourseDetail>("POST", "/admin/courses", admin, { title: "推播付費課", teacher: "王", priceTwd: 500, status: "published" })).data;
    sent.length = 0;
    await call<Order[]>("POST", "/orders", student, { courseIds: [paid.id] });
    assert.equal(sent.length, 1, "只推給有開推播的學員本人");

    // 裝置失效（410）→ 自動刪除訂閱
    status = 410;
    await call("POST", "/push/test", student);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").first<{ n: number }>();
    assert.equal(left!.n, 0);

    // 開課前一天提醒：台灣時間 20:00 後，明天開課的已報名學員各收到一則，同一天只發一次
    const now = Date.parse("2026-12-01T13:00:00Z"); // 台灣 21:00
    const free = (await call<CourseDetail>("POST", "/admin/courses", admin, { title: "明天的課", teacher: "王", priceTwd: 0, status: "published", eventStart: "2026-12-02" })).data;
    await call<Order[]>("POST", "/orders", student, { courseIds: [free.id] });
    assert.equal(await courseReminders(env, Date.parse("2026-12-01T11:00:00Z")), 0, "台灣 19:00 還不發");
    assert.equal(await courseReminders(env, now), 1);
    assert.equal(await courseReminders(env, now + 600_000), 0, "同一天只發一次");
    const n = await env.DB.prepare("SELECT title, link FROM notifications WHERE recipient_sub = 'demo-student' AND title = '明天開課提醒'").first<{ title: string; link: string }>();
    assert.equal(n?.link, `/course/${free.id}`);
  } finally {
    globalThis.fetch = orig;
  }
});
