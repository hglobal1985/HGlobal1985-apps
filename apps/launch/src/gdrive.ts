import type { Env } from "./d1.ts";

/**
 * Google 雲端硬碟上傳（業主 2026-11-18）：業主用 hglobal1985@gmail.com 授權一次，
 * 之後管理員上傳的檔案由伺服器代為存進業主的雲端硬碟「行動大學上傳」資料夾。
 * 權限只要 drive.file（只能碰這個 App 自己建立的檔案與資料夾，看不到業主其他檔案）。
 * 長期通行證存在資料庫（drive_link），不在 repo、不回傳前端；Google 用戶端代碼與密鑰是 Cloudflare Secret。
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
export const DRIVE_FOLDER_NAME = "行動大學上傳";
/** 單檔上限（伺服器分段轉傳，沒有技術上限；這是避免誤傳超大檔）。 */
export const DRIVE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** 每段大小：Google 規定必須是 256KB 的倍數（最後一段除外）。 */
export const DRIVE_CHUNK_BYTES = 8 * 1024 * 1024;
const SESSION_PREFIX = "https://www.googleapis.com/upload/drive/v3/files?";

export const driveConfigured = (env: Env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export class DriveError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 授權網址（要求離線存取，才拿得到長期通行證）。 */
export function authUrl(env: Env, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID ?? "", redirect_uri: redirectUri, response_type: "code", scope: DRIVE_SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state, login_hint: "hglobal1985@gmail.com" });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenCall(env: Env, params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID ?? "", client_secret: env.GOOGLE_CLIENT_SECRET ?? "", ...params }) });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string };
  if (!res.ok || !data.access_token) throw new DriveError(res.status === 400 && data.error === "invalid_grant" ? 401 : 502, data.error === "invalid_grant" ? "drive_grant_invalid" : "drive_token_failed", data.error === "invalid_grant" ? "雲端硬碟授權已失效" : "向 Google 換取授權失敗");
  return { access_token: data.access_token, refresh_token: data.refresh_token };
}

/** 授權碼換通行證，並建立「行動大學上傳」資料夾。 */
export async function completeConnect(env: Env, code: string, redirectUri: string): Promise<{ refreshToken: string; email: string; folderId: string }> {
  const t = await tokenCall(env, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
  if (!t.refresh_token) throw new DriveError(502, "drive_no_refresh", "Google 沒有給長期授權，請重新連結");
  const info = (await (await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { authorization: `Bearer ${t.access_token}` } })).json().catch(() => ({}))) as { email?: string };
  const folderId = await createFolder(t.access_token);
  return { refreshToken: t.refresh_token, email: info.email ?? "", folderId };
}

export async function createFolder(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }) });
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  if (!res.ok || !data.id) throw new DriveError(502, "drive_folder_failed", "無法在雲端硬碟建立資料夾");
  return data.id;
}

export type DriveLink = { refresh_token: string; account_email: string; folder_id: string; folder_name: string; connected_at: string; broken: number };

/** 用長期通行證換一次性的存取權杖；通行證失效就標記為「需要重新連結」。 */
export async function accessToken(env: Env): Promise<{ token: string; link: DriveLink }> {
  const link = await env.DB.prepare("SELECT refresh_token, account_email, folder_id, folder_name, connected_at, broken FROM drive_link WHERE id = 1").first<DriveLink>();
  if (!link) throw new DriveError(503, "drive_not_connected", "尚未連結 Google 雲端硬碟，請超級管理員先到「雲端硬碟上傳」連結");
  if (link.broken) throw new DriveError(503, "drive_broken", "雲端硬碟授權已失效，請超級管理員重新連結");
  try {
    const t = await tokenCall(env, { grant_type: "refresh_token", refresh_token: link.refresh_token });
    return { token: t.access_token, link };
  } catch (e) {
    if (e instanceof DriveError && e.code === "drive_grant_invalid") {
      await env.DB.prepare("UPDATE drive_link SET broken = 1 WHERE id = 1").run();
      throw new DriveError(503, "drive_broken", "雲端硬碟授權已失效，請超級管理員重新連結");
    }
    throw e;
  }
}

/** 開一個「可續傳」的上傳工作，回傳 Google 的上傳位址（之後一段一段轉傳）。 */
export async function startUpload(token: string, folderId: string, name: string, mime: string, size: number): Promise<string> {
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,webViewLink", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": mime || "application/octet-stream", "x-upload-content-length": String(size) },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  const loc = res.headers.get("location");
  if (!res.ok || !loc) throw driveFailure(res.status, await res.text().catch(() => ""));
  return loc;
}

/** 只允許轉傳到 Google 的上傳位址（防止被拿去連別的網址）。 */
export const isUploadSession = (u: string) => u.startsWith(SESSION_PREFIX) && /[?&]upload_id=[\w-]+/.test(u);

export type ChunkResult = { done: false; next: number } | { done: true; file: { id: string; name: string; size: number; webViewLink: string } };

/** 轉傳一段檔案內容。308＝還要繼續（回報 Google 已收到多少）；200／201＝完成。 */
export async function sendChunk(session: string, data: ArrayBuffer, start: number, total: number): Promise<ChunkResult> {
  const end = start + data.byteLength - 1;
  const res = await fetch(session, { method: "PUT", headers: { "content-length": String(data.byteLength), "content-range": `bytes ${start}-${end}/${total}` }, body: data });
  if (res.status === 308) {
    const got = /bytes=0-(\d+)/.exec(res.headers.get("range") ?? "");
    return { done: false, next: got ? Number(got[1]) + 1 : 0 };
  }
  if (res.ok) {
    const f = (await res.json().catch(() => ({}))) as { id?: string; name?: string; size?: string; webViewLink?: string };
    if (!f.id) throw new DriveError(502, "drive_bad_response", "Google 回應異常，請重新上傳");
    return { done: true, file: { id: f.id, name: f.name ?? "", size: Number(f.size ?? total), webViewLink: f.webViewLink ?? "" } };
  }
  throw driveFailure(res.status, await res.text().catch(() => ""));
}

function driveFailure(status: number, body: string): DriveError {
  if (/storageQuotaExceeded|quotaExceeded|insufficient storage/i.test(body)) return new DriveError(507, "drive_full", "Google 雲端硬碟容量已滿，請業主清理或加購容量");
  if (status === 404 || status === 410) return new DriveError(410, "drive_session_expired", "這次上傳已逾時，請重新上傳");
  if (status === 401 || status === 403) return new DriveError(503, "drive_denied", "Google 拒絕這次上傳，請超級管理員重新連結雲端硬碟");
  return new DriveError(502, "drive_failed", "上傳到雲端硬碟失敗，請稍後再試");
}

/** 檔名整理（去掉路徑符號與控制字元）。 */
export const cleanDriveName = (name: string) => name.replace(/[\\/\u0000-\u001f]/g, "_").trim().slice(0, 200);

/** 取消連結：向 Google 撤銷通行證（失敗也沒關係）。 */
export async function revoke(refreshToken: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" }).catch(() => undefined);
}
