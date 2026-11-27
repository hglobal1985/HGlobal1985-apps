/**
 * 中央會員串接（串接指令 https://id.hglobal1985.com/handoff/check）。
 * - 驗證 Access Token：RS256、typ=at+jwt、iss/aud＝中央網址、app_id＝check、exp。會員主鍵只用 sub（member_id）。
 * - 超級管理員：以 GET /v1/apps/check/handoff 確認（中央只接受超級管理員從本 App 呼叫）。
 * - 不保存任何 Amway 資料；日誌不得出現 Token、信箱、姓名。
 */
import { createTokenVerifier, SIGNATURE_TOLERANCE_SECONDS, verifyWebhook } from "../../../packages/server-shared/src/central-verify.ts";
import { createErrorDigest } from "../../../packages/server-shared/src/error-digest.ts";
import { fetchBackupConfig } from "../../../packages/server-shared/src/weekly-backup.ts";
import { createServiceClient } from "../../../packages/server-shared/src/central-service.ts";
export const CENTRAL = "https://id.hglobal1985.com";
export const APP_ID = "check";
/** 採用的串接指令版本（每次依新版指令更新完才改）。 */
export const INTEGRATED_VERSION = "2026-11-27.2";
/** 已做到的平台標準（只列真的做到的）。 */
export const STANDARDS = ["webhook", "delete_copy", "no_email_copy", "least_scope", "in_app_delete"];

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let centralFetch: Fetch = (input, init) => fetch(input, init);
/** 前台錯誤統計 → 中央（生態系統功能 3；只送種類、頁面路徑、次數）。 */
export const errorDigest = createErrorDigest({ central: CENTRAL, appId: APP_ID, version: "0.1.0", getFetch: () => centralFetch });
/** 每週備份設定（生態系統功能 4）：讀中央 config.eco_features.weekly_backup；沒有、關閉或連不上回 null（這次不備份）。 */
export const fetchEcoBackupConfig = () => fetchBackupConfig(CENTRAL, APP_ID, () => centralFetch);
/** 測試用：替換對中央的網路請求。 */
export function setCentralFetch(f: Fetch): void {
  centralFetch = f;
  keys.clear();
  memo.clear();
}

// Access Token 驗證：伺服器共用模組（packages/server-shared/src/central-verify.ts，兩個 App 同一份）。
const verifier = createTokenVerifier(CENTRAL, APP_ID, () => centralFetch);
const keys = { clear: verifier.reset };
/** 驗證 Access Token，成功回傳 member_id，失敗回傳 null。 */
export const verifyAccessToken = (token: string): Promise<string | null> => verifier.verify(token);
/** 寄 Email 前向中央查聯絡信箱（伺服器共用模組 central-service.ts；用完即丟，不寫入資料庫或日誌）。 */
export const lookupContactEmails = createServiceClient(CENTRAL, APP_ID, () => centralFetch).lookupContactEmails;

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

export { SIGNATURE_TOLERANCE_SECONDS, verifyWebhook };
