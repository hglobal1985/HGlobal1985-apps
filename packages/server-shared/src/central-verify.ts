/**
 * 中央會員串接的伺服器共用驗證（行動大學 apps/launch 與寰宇繳作業系統 apps/check-api 共用同一份；杜杜龍 2026-11-27）。
 * - Access Token：RS256、typ=at+jwt、iss/aud＝中央網址、app_id＝這個 App、exp／nbf；會員主鍵只用 sub。
 * - Webhook：X-HG-Signature＝v1=HMAC-SHA256(金鑰, `${時間戳}.${原始內容}`)，常數時間比對、時間窗 5 分鐘。
 * 日誌不得出現 Token、信箱、姓名。
 */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

type Claims = { sub: string; iss: string; aud: string; app_id: string; exp: number; nbf?: number };

const b64urlBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};
const b64urlJson = (s: string): unknown => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

export const looksLikeJwt = (token: string) => /^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(token);

/**
 * 建立一個 Access Token 驗證器（每個 App 一個）。getFetch 每次呼叫時才取，方便測試替換網路請求。
 * 回傳 verify（成功回 sub，失敗回 null；遇到不認得的 kid 會重新抓 JWKS）與 reset（清掉公鑰快取）。
 */
export function createTokenVerifier(central: string, appId: string, getFetch: () => Fetch) {
  const keys = new Map<string, { key: CryptoKey; until: number }>();
  let loading: Promise<void> | null = null;

  async function loadKeys(): Promise<void> {
    if (loading) return loading;
    loading = (async () => {
      const res = await getFetch()(`${central}/oauth/jwks`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw Error("jwks_unavailable");
      const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string; use?: string })[] };
      const found: { kid: string; key: CryptoKey }[] = [];
      for (const jwk of body.keys ?? []) {
        if (jwk.kty !== "RSA" || !jwk.kid || (jwk.use && jwk.use !== "sig") || (jwk.alg && jwk.alg !== "RS256")) continue;
        found.push({ kid: jwk.kid, key: await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]) });
      }
      if (!found.length) throw Error("empty_jwks");
      keys.clear();
      for (const f of found) keys.set(f.kid, { key: f.key, until: Date.now() + 600_000 });
    })();
    try {
      await loading;
    } finally {
      loading = null;
    }
  }

  async function verify(token: string): Promise<string | null> {
    try {
      if (token.length > 8192 || !looksLikeJwt(token)) return null;
      const [h, p, s] = token.split(".") as [string, string, string];
      const header = b64urlJson(h) as { alg?: string; typ?: string; kid?: string };
      if (header.alg !== "RS256" || header.typ !== "at+jwt" || !header.kid) return null;
      let entry = keys.get(header.kid);
      if (!entry || entry.until <= Date.now()) {
        await loadKeys();
        entry = keys.get(header.kid);
      }
      if (!entry) return null;
      const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", entry.key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
      if (!ok) return null;
      const c = b64urlJson(p) as Claims;
      const now = Math.floor(Date.now() / 1000);
      if (c.iss !== central || c.aud !== central || c.app_id !== appId) return null;
      if (typeof c.sub !== "string" || !c.sub || c.sub.length > 128) return null;
      if (typeof c.exp !== "number" || c.exp <= now || (c.nbf && c.nbf > now)) return null;
      return c.sub;
    } catch {
      return null;
    }
  }

  return { verify, reset: () => keys.clear() };
}

export const SIGNATURE_TOLERANCE_SECONDS = 300;
const te = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** 驗證中央 webhook 簽章（見檔頭）。 */
export async function verifyWebhook(secret: string, timestamp: string | null, signature: string | null, raw: string, nowMs = Date.now()): Promise<boolean> {
  if (!timestamp || !signature || !/^\d{9,13}$/.test(timestamp)) return false;
  const t = Number(timestamp);
  const seconds = t > 1e12 ? t / 1000 : t;
  if (Math.abs(nowMs / 1000 - seconds) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey("raw", te.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = `v1=${hex(await crypto.subtle.sign("HMAC", key, te.encode(`${timestamp}.${raw}`)))}`;
  if (want.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
