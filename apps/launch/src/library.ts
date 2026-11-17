/**
 * 「我的圖書館」的純邏輯（業主 2026-11-17）：密碼雜湊與驗證、解鎖憑證、網址編號格式。不碰資料庫，方便測試。
 * 密碼用 PBKDF2-SHA256（100,000 次、每個密碼自己的隨機鹽）；解鎖憑證是用「密碼雜湊」當金鑰簽的短效憑證（最長 12 小時，也不會超過密碼本身的失效時間），
 * 所以圖書館／書換了密碼或關閉密碼，舊憑證立刻全部失效；不需要另外存任何金鑰或 Session。
 */
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

export async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
  return { hash: hex(bits), salt: hex(salt.buffer as ArrayBuffer) };
}

export async function checkPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const r = await hashPassword(password, salt);
  if (r.hash.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= r.hash.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

/** 密碼設定檢查：4～40 字；天數 1～365（空白＝不會自動失效）。 */
export function checkPasswordInput(password: unknown, days: unknown): { ok: true; password: string; days: number | null } | { ok: false; message: string } {
  if (typeof password !== "string" || password.length < 4 || password.length > 40) return { ok: false, message: "密碼要 4 到 40 個字" };
  if (days === null || days === undefined || days === "") return { ok: true, password, days: null };
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > 365) return { ok: false, message: "幾天後失效請填 1 到 365 的整數，或留空（不自動失效）" };
  return { ok: true, password, days: n };
}

export const expiresAt = (days: number | null, now = Date.now()): string | null => (days === null ? null : new Date(now + days * 86_400_000).toISOString());
/** 密碼是否還有效（沒設定失效時間＝一直有效）。 */
export const pwActive = (expires: string | null, now = Date.now()): boolean => expires === null || Date.parse(expires) > now;

const hmac = async (keyHex: string, msg: string) => {
  const key = await crypto.subtle.importKey("raw", fromHex(keyHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
};

/** 解鎖憑證：`到期毫秒.簽章`；scope＝"lib" 或書的編號。 */
export async function makeToken(pwHash: string, scope: string, pwExpires: string | null, now = Date.now()): Promise<{ token: string; until: number }> {
  const until = Math.min(now + 12 * 3600_000, pwExpires ? Date.parse(pwExpires) : Infinity);
  return { token: `${until}.${await hmac(pwHash, `${scope}|${until}`)}`, until };
}
export async function checkToken(token: unknown, pwHash: string, scope: string, now = Date.now()): Promise<boolean> {
  if (typeof token !== "string") return false;
  const [u, sig] = token.split(".");
  const until = Number(u);
  if (!sig || !Number.isFinite(until) || until <= now) return false;
  return sig === (await hmac(pwHash, `${scope}|${until}`));
}

/** 圖書館網址編號：會員編號轉小寫，只留英數與短橫線；太短（少於 3 字）不能用。 */
export const libraryNumber = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const n = raw.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
  return /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(n) ? n : null;
};
