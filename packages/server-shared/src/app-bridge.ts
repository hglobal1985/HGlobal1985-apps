/**
 * App 之間的內部橋接（杜杜龍 2026-11-28：行動大學通知頁要有「繳作業」分頁，做法 A＝即時向對方讀、不存副本）。
 * 兩個 Worker 各設同一個 Cloudflare Secret `APP_BRIDGE_SECRET`（由杜杜龍設定，不放程式庫、不貼進對話）。
 * 呼叫端（行動大學伺服器）只會帶「自己已驗證過的登入會員」的 member_id；接收端用常數時間比對 Bearer 密鑰，
 * 沒設密鑰、密鑰不對一律拒絕（fail closed）。密鑰只存在 Worker 環境變數，不進日誌。
 */
const te = new TextEncoder();

/** 常數時間比對 Authorization: Bearer <secret>；沒設密鑰（空字串或 undefined）一律 false。 */
export function bridgeAuthorized(secret: string | undefined, authorization: string | null): boolean {
  if (!secret || secret.length < 16 || !authorization?.startsWith("Bearer ")) return false;
  const got = te.encode(authorization.slice(7));
  const want = te.encode(secret);
  let diff = got.length ^ want.length;
  for (let i = 0; i < want.length; i++) diff |= (got[i] ?? 0) ^ want[i]!;
  return diff === 0;
}

/** 對另一個 App 的內部網址送 POST（逾時 5 秒）；密鑰沒設、連不上或不是 2xx 回 null。 */
export async function bridgePost<T>(secret: string | undefined, url: string, body: unknown, doFetch: (u: string, i: RequestInit) => Promise<Response> = (u, i) => fetch(u, i)): Promise<T | null> {
  if (!secret) return null;
  try {
    const res = await doFetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000), redirect: "manual" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}
