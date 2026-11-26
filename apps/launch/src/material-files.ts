import type { D1Database, R2Bucket } from "./d1.ts";

/**
 * 教材檔案（杜杜龍 2026-11-18）：檔案一律存在行動大學自己的儲存空間（R2），下載一律經過「權限檢查＋一次性下載連結」。
 * 來源有兩種：從手機／電腦選檔案上傳，或從使用者「自己的」Google 雲端硬碟選檔案，由伺服器讀取後轉存進 R2
 * （使用者在瀏覽器授權一次性的存取權杖，只用在這一次轉存，不保存、不寫日誌；杜杜龍的雲端硬碟完全不介入）。
 */

// ---------- 設定（設定 › 儲存空間管理 › 上傳與下載設定） ----------

export type FileSettings = {
  /** 從 Google 雲端硬碟匯入的單檔上限（MB）。（手機／電腦直接上傳的上限是 app 設定的 fileMaxMb，受網路請求大小限制最多 95MB。） */
  importMaxMb: number;
  /** 下載連結有效秒數。 */
  ticketSec: number;
  /** 每位會員 24 小時內最多下載幾個檔案、幾 MB（0＝不限）。管理員不受限。 */
  dailyDownloads: number;
  dailyDownloadMb: number;
};
export const DEFAULT_FILE_SETTINGS: FileSettings = { importMaxMb: 200, ticketSec: 120, dailyDownloads: 50, dailyDownloadMb: 10240 };
const clampInt = (v: unknown, d: number, lo: number, hi: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
export function normalizeFileSettings(raw: unknown): FileSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_FILE_SETTINGS;
  return {
    importMaxMb: clampInt(r.importMaxMb, d.importMaxMb, 1, 1024),
    ticketSec: clampInt(r.ticketSec, d.ticketSec, 30, 600),
    dailyDownloads: clampInt(r.dailyDownloads, d.dailyDownloads, 0, 1000),
    dailyDownloadMb: clampInt(r.dailyDownloadMb, d.dailyDownloadMb, 0, 1_000_000),
  };
}
const KEY = "files";
export async function loadFileSettings(db: D1Database): Promise<FileSettings> {
  const row = await db.prepare("SELECT value FROM ui_settings WHERE key = ?").bind(KEY).first<{ value: string }>();
  try {
    return normalizeFileSettings(row ? JSON.parse(row.value) : {});
  } catch {
    return normalizeFileSettings({});
  }
}
export async function saveFileSettings(db: D1Database, v: FileSettings): Promise<void> {
  await db.prepare("INSERT INTO ui_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(KEY, JSON.stringify(v)).run();
}

// ---------- 從使用者自己的 Google 雲端硬碟讀取 ----------

export class ImportError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Google 自己格式的檔案（文件、試算表、簡報、繪圖）要先轉成一般檔案才能下載。 */
const EXPORTS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.spreadsheet": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: ".xlsx" },
  "application/vnd.google-apps.presentation": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: ".pptx" },
  "application/vnd.google-apps.drawing": { mime: "image/png", ext: ".png" },
};
export type DriveSource = { name: string; size: number | null; open: () => Promise<Response> };

/** 用使用者授權的一次性權杖，取得他挑選的那個檔案的資料與內容（權杖只有這個 App 的 drive.file 權限＝只能讀他親手選的檔案）。 */
export async function openUserDriveFile(token: string, fileId: string): Promise<DriveSource> {
  const auth = { authorization: `Bearer ${token}` };
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,trashed&supportsAllDrives=true`, { headers: auth });
  if (res.status === 401) throw new ImportError(401, "google_token_invalid", "Google 授權已失效，請重新選擇檔案");
  if (res.status === 403 || res.status === 404) throw new ImportError(404, "google_file_not_found", "讀不到這個檔案（可能沒有權限，或檔案已被刪除）");
  if (!res.ok) throw new ImportError(502, "google_failed", "向 Google 讀取檔案失敗，請稍後再試");
  const m = (await res.json()) as { name?: string; mimeType?: string; size?: string; trashed?: boolean };
  if (m.trashed) throw new ImportError(404, "google_file_not_found", "這個檔案已在垃圾桶");
  const mime = m.mimeType ?? "";
  if (mime === "application/vnd.google-apps.folder") throw new ImportError(400, "google_folder", "不能匯入整個資料夾，請選資料夾裡的檔案");
  const base = (m.name ?? "").trim() || "檔案";
  if (mime.startsWith("application/vnd.google-apps.")) {
    const ex = EXPORTS[mime];
    if (!ex) throw new ImportError(400, "google_unsupported", "這種 Google 檔案（表單、網站…）不能匯入");
    return { name: base.toLowerCase().endsWith(ex.ext) ? base : base + ex.ext, size: null, open: () => fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(ex.mime)}`, { headers: auth }) };
  }
  return { name: base, size: m.size ? Number(m.size) : null, open: () => fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: auth }) };
}

// ---------- 串流存進 R2 ----------

/** 每段大小（R2 分段上傳每段至少 5MiB，除了最後一段）。 */
export const PART_BYTES = 8 * 1024 * 1024;

/**
 * 把一串資料邊讀邊存進 R2（不把整個檔案放進記憶體）：小檔直接存，大檔用分段上傳；超過 maxBytes 或中途失敗就中止並清掉。回傳總大小。
 */
export async function streamToR2(bucket: R2Bucket, key: string, body: ReadableStream<Uint8Array>, contentType: string, maxBytes: number, onProgress?: (bytesRead: number) => Promise<void> | void): Promise<number> {
  const reader = body.getReader();
  let buf = new Uint8Array(PART_BYTES);
  let filled = 0;
  let total = 0;
  let uploadId: string | null = null;
  const parts: { partNumber: number; etag: string }[] = [];
  const upload = () => bucket.resumeMultipartUpload(key, uploadId!);
  const flush = async () => {
    if (!uploadId) uploadId = (await bucket.createMultipartUpload(key, { httpMetadata: { contentType } })).uploadId;
    parts.push(await upload().uploadPart(parts.length + 1, buf.slice(0, filled).buffer));
    filled = 0;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      await onProgress?.(total);
      if (total > maxBytes) throw new ImportError(413, "file_too_large", "檔案超過大小上限");
      let off = 0;
      while (off < value.byteLength) {
        const n = Math.min(buf.byteLength - filled, value.byteLength - off);
        buf.set(value.subarray(off, off + n), filled);
        filled += n;
        off += n;
        if (filled === buf.byteLength) await flush();
      }
    }
    if (total === 0) throw new ImportError(400, "empty_file", "檔案是空的");
    if (!uploadId) await bucket.put(key, buf.slice(0, filled).buffer, { httpMetadata: { contentType } });
    else {
      if (filled > 0) await flush();
      await upload().complete(parts);
    }
    return total;
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    if (uploadId) await upload().abort().catch(() => undefined);
    else await bucket.delete(key).catch(() => undefined);
    throw e;
  } finally {
    buf = new Uint8Array(0);
  }
}

// ---------- 撤銷舊的「杜杜龍雲端硬碟上傳」授權（杜杜龍 2026-11-18 取消該功能；排程會自動處理一次） ----------

/** 如果資料庫還留著舊的授權通行證：向 Google 撤銷，並刪掉相關設定。可重複執行。 */
export async function revokeLegacyDriveLink(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT refresh_token FROM drive_link WHERE id = 1").first<{ refresh_token: string }>().catch(() => null);
  if (!row) return false;
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(row.refresh_token)}`, { method: "POST" }).catch(() => undefined);
  await db.batch([db.prepare("DELETE FROM drive_link"), db.prepare("DELETE FROM drive_oauth_state"), db.prepare("DELETE FROM ui_settings WHERE key = 'drive'")]);
  return true;
}
