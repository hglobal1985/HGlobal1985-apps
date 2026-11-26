/**
 * 中央會員串接（串接指令 https://id.hglobal1985.com/handoff/check）。
 * - 驗證 Access Token：RS256、typ=at+jwt、iss/aud＝中央網址、app_id＝check、exp。會員主鍵只用 sub（member_id）。
 * - 超級管理員：以 GET /v1/apps/check/handoff 確認（中央只接受超級管理員從本 App 呼叫）。
 * - 不保存任何 Amway 資料；日誌不得出現 Token、信箱、姓名。
 */
export const CENTRAL = "https://id.hglobal1985.com";
export const APP_ID = "check";
/** 採用的串接指令版本（每次依新版指令更新完才改）。 */
export const INTEGRATED_VERSION = "2026-11-24.3";
/** 已做到的平台標準（只列真的做到的）。 */
export const STANDARDS = ["webhook", "delete_copy", "no_email_copy", "least_scope", "in_app_delete"];

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let centralFetch: Fetch = (input, init) => fetch(input, init);
/** 測試用：替換對中央的網路請求。 */
export function setCentralFetch(f: Fetch): void {
  centralFetch = f;
  keys.clear();
  memo.clear();
}

type Claims = { sub: string; iss: string; aud: string; app_id: string; exp: number; nbf?: number };
const keys = new Map<string, { key: CryptoKey; until: number }>();
let loading: Promise<void> | null = null;

const b64urlBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};
const b64urlJson = (s: string): unknown => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function loadKeys(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const res = await centralFetch(`${CENTRAL}/oauth/jwks`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
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

const looksLikeJwt = (t: string) => /^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(t);

/** 驗證 Access Token，成功回傳 member_id，失敗回傳 null。遇到不認得的 kid 會重新抓 JWKS。 */
export async function verifyAccessToken(token: string): Promise<string | null> {
  try {
    if (token.length > 8192 || !looksLikeJwt(token)) return null;
    const [h, p, s] = token.split(".");
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
    if (c.iss !== CENTRAL || c.aud !== CENTRAL || c.app_id !== APP_ID) return null;
    if (typeof c.sub !== "string" || !c.sub || c.sub.length > 128) return null;
    if (typeof c.exp !== "number" || c.exp <= now || (c.nbf && c.nbf > now)) return null;
    return c.sub;
  } catch {
    return null;
  }
}

/** 記憶體快取（只放記憶體，不落地）。失敗不快取。 */
const memo = new Map<string, { value: unknown; until: number }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T | undefined>): Promise<T | undefined> {
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) return hit.value as T;
  const value = await load();
  if (value !== undefined) {
    if (memo.size > 5000) memo.clear();
    memo.set(key, { value, until: Date.now() + ttlMs });
  }
  return value;
}
export function forgetMember(sub: string): void {
  for (const k of [...memo.keys()]) if (k.endsWith(`:${sub}`)) memo.delete(k);
}

async function callCentral(token: string, path: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await centralFetch(CENTRAL + path, {
      ...init,
      headers: { accept: "application/json", authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  }
}

/** 會員本人的顯示名稱與頭像（用本人的 Token 讀；給老師、組員顯示用）。讀不到回 undefined。 */
export async function ownProfile(sub: string, token: string): Promise<{ name: string; avatarUrl: string | null } | undefined> {
  return cached(`profile:${sub}`, 600_000, async () => {
    const res = await callCentral(token, "/v1/me/profile");
    if (!res?.ok) return undefined;
    const b = (await res.json()) as { fields?: Record<string, { value?: unknown }>; avatar?: { url?: unknown } };
    const v = b.fields?.display_name?.value;
    const a = typeof b.avatar?.url === "string" ? b.avatar.url : "";
    const avatarUrl = a.startsWith("/") ? `${CENTRAL}${a}` : /^https:\/\//.test(a) ? a : null;
    return { name: typeof v === "string" ? v.trim().slice(0, 60) : "", avatarUrl };
  });
}

/**
 * 是否為中央的超級管理員：GET /v1/apps/check/handoff 只有超級管理員、而且只有本 App 的登入能呼叫成功。
 * 順便完成「回報串接版本與標準符合度」。查不到一律當作不是（fail closed），成功結果快取 10 分鐘。
 */
export async function isSuperAdmin(sub: string, token: string): Promise<boolean> {
  const r = await cached(`super:${sub}`, 600_000, async () => {
    const res = await callCentral(token, `/v1/apps/${APP_ID}/handoff?integrated=${INTEGRATED_VERSION}&standards=${STANDARDS.join(",")}`);
    if (!res) return undefined;
    if (res.ok) return true;
    if (res.status === 401 || res.status === 403) return false;
    return undefined;
  });
  return r === true;
}

export const SIGNATURE_TOLERANCE_SECONDS = 300;
const te = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** 驗證中央 webhook：X-HG-Signature＝v1=HMAC-SHA256(金鑰, `${時間戳}.${原始內容}`)，常數時間比對、時間窗 5 分鐘。 */
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
