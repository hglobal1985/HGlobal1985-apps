/**
 * 手機推播（Web Push）的加密與傳送（兩個伺服器共用：寰宇行動大學、寰宇繳作業系統；杜杜龍 2026-11-27 從 apps/launch/src/push.ts 抽出）。
 * - 金鑰：VAPID 私鑰（JWK 的 JSON 文字）放在各自 Worker 的 Cloudflare Secret `VAPID_PRIVATE_JWK`；公鑰由私鑰算出。
 * - 內容依 RFC 8291（aes128gcm）加密；只用 Web Crypto，不靠外部套件。
 * - 誰該收、哪些通知要推，由各 App 自己的程式決定（行動大學 push.ts、繳作業系統 api.ts）。
 */
const enc = new TextEncoder();
type B = Uint8Array<ArrayBuffer>;
const b64u = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64u = (s: string): B => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};
const concat = (...parts: Uint8Array[]): B => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

type Jwk = { kty: "EC"; crv: "P-256"; x: string; y: string; d: string };
/** VAPID 私鑰（Cloudflare Secret 的 JSON 文字）→ JWK；格式不對或沒設定回 null。 */
export function vapidJwk(secret: string | undefined): Jwk | null {
  try {
    const j = secret ? (JSON.parse(secret) as Jwk) : null;
    return j && j.kty === "EC" && j.crv === "P-256" && j.x && j.y && j.d ? j : null;
  } catch {
    return null;
  }
}

/** 給瀏覽器訂閱用的公鑰（65 bytes 未壓縮點，base64url）；沒設定金鑰回 null。 */
export function vapidPublicKey(secret: string | undefined): string | null {
  const j = vapidJwk(secret);
  return j ? b64u(concat(new Uint8Array([4]), fromB64u(j.x), fromB64u(j.y))) : null;
}

async function vapidAuth(jwk: Jwk, endpoint: string, subject: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", { ...jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  const pub = b64u(concat(new Uint8Array([4]), fromB64u(jwk.x), fromB64u(jwk.y)));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${pub}`;
}

async function hkdf(salt: B, ikm: B, info: B, len: number): Promise<B> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}

/** RFC 8291 加密（aes128gcm，單一記錄）。 */
export async function encryptPayload(p256dh: string, authSecret: string, plaintext: Uint8Array): Promise<B> {
  const uaPublic = fromB64u(p256dh);
  const auth = fromB64u(authSecret);
  const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export type PushSub = { endpoint: string; p256dh: string; auth: string };
export type PushMessage = { title: string; body: string; link: string };

/** 推一則給一個裝置；回傳 "ok"、"gone"（訂閱已失效，要刪除）或 "error"。fetcher 可替換（測試用）。 */
export async function sendPush(secret: string | undefined, subject: string, sub: PushSub, msg: PushMessage, fetcher: typeof fetch = fetch): Promise<"ok" | "gone" | "error"> {
  const jwk = vapidJwk(secret);
  if (!jwk) return "error";
  try {
    const body = await encryptPayload(sub.p256dh, sub.auth, enc.encode(JSON.stringify(msg)));
    const res = await fetcher(sub.endpoint, {
      method: "POST",
      headers: { authorization: await vapidAuth(jwk, sub.endpoint, subject), "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: "normal" },
      body,
    });
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}
