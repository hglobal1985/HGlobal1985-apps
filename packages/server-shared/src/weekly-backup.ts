/**
 * 每週備份（生態系統功能 4 weekly_backup；串接指令 2026-11-27.5 三、18 (4)；伺服器共用模組，杜杜龍 2026-11-27）。
 * App 讀中央 GET /v1/apps/<app_id>/config 的 config.eco_features.weekly_backup（{enabled, weekday, keep}），
 * 在設定的星期（0＝星期日…6＝星期六，台北時間）凌晨 3 點由排程把「自己的永久資料」匯出到自己的 R2：
 *   backups/<台北日期>/<表名>.<序號>.ndjson（每行一列 JSON，每檔最多 5000 列）、README.txt、manifest.json（最後才寫，沒有它代表不完整）。
 * 只備份呼叫端「明確列出」的資料表與欄位（新資料表預設不備份）；不含 Amway 資料、Token 與密碼雜湊、登入與暫存資料、圖檔本體。
 * 寫完只留最近 keep 份；config 沒有 weekly_backup 或 enabled 為 false 就不備份；同一天只做一次（今天的 manifest.json 已存在就略過）。
 * 備份檔只放 R2，不放公開程式庫、不貼進對話或 Issue。還原須杜杜龍核准（README.txt 有說明）。
 */

export type BackupTables = Readonly<Record<string, readonly string[]>>;

/** 最小的 D1／R2 型別（兩個 App 的環境型別都相容）。 */
export interface BackupDb {
  prepare(sql: string): { bind(...values: unknown[]): { all<T = Record<string, unknown>>(): Promise<{ results?: T[] }> } };
}
export interface BackupBucket {
  put(key: string, value: string, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  head(key: string): Promise<unknown | null>;
  list(opts: { prefix: string; delimiter?: string; cursor?: string }): Promise<{ objects: { key: string }[]; delimitedPrefixes: string[]; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<void>;
}

export const BACKUP_PREFIX = "backups/";
/** 每個備份檔最多幾列（Worker 記憶體有限，大表分成多個檔）。 */
export const ROWS_PER_FILE = 5000;
export const BACKUP_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const backupFolder = (date: string): string => `${BACKUP_PREFIX}${date}/`;

export type BackupConfig = { enabled: boolean; weekday: number; keep: number };

/** 台北時間（UTC+8）的日期、星期、時。 */
export function taipeiNow(now: Date): { date: string; weekday: number; hour: number } {
  const t = new Date(now.getTime() + 8 * 3600 * 1000);
  return { date: t.toISOString().slice(0, 10), weekday: t.getUTCDay(), hour: t.getUTCHours() };
}

/** 在設定的星期、台北 03:00～03:59 之間算「到了時間」（各 App 排程間隔不同，用整點 3 點；同一天是否已做另外用 manifest 判斷）。 */
export function isBackupWindow(weekday: number, now: Date): boolean {
  const p = taipeiNow(now);
  return p.weekday === weekday && p.hour === 3;
}

/** 從中央 config 取出 weekly_backup 設定；沒有、格式不對或 enabled 不是 true 一律視為關閉。 */
export function parseBackupConfig(json: unknown): BackupConfig | null {
  const wb = (json as { config?: { eco_features?: { weekly_backup?: { enabled?: unknown; weekday?: unknown; keep?: unknown } } } } | null)?.config?.eco_features?.weekly_backup;
  if (!wb || wb.enabled !== true) return null;
  const weekday = typeof wb.weekday === "number" && Number.isInteger(wb.weekday) && wb.weekday >= 0 && wb.weekday <= 6 ? wb.weekday : 0;
  const keep = typeof wb.keep === "number" && Number.isInteger(wb.keep) && wb.keep >= 1 && wb.keep <= 52 ? wb.keep : 8;
  return { enabled: true, weekday, keep };
}

/** 讀中央設定；連不上或不是 200 回 null（＝這次不備份，下一次排程再試）。 */
export async function fetchBackupConfig(central: string, appId: string, getFetch?: () => (u: string, i?: RequestInit) => Promise<Response>): Promise<BackupConfig | null> {
  try {
    const f = getFetch?.() ?? ((u: string, i?: RequestInit) => fetch(u, i));
    const res = await f(`${central}/v1/apps/${appId}/config`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return parseBackupConfig(await res.json());
  } catch {
    return null;
  }
}

/** 從 R2 列出的資料夾名稱（backups/2026-11-29/）挑出該刪除的舊備份：只留最近 keep 份（依日期）。 */
export function backupsToDelete(folders: readonly string[], keep: number): string[] {
  const dates = folders
    .map((f) => f.slice(BACKUP_PREFIX.length).replace(/\/$/, ""))
    .filter((d) => BACKUP_DATE.test(d))
    .sort()
    .reverse();
  return dates.slice(Math.max(keep, 1)).map(backupFolder);
}

export interface BackupManifest {
  version: 1;
  app: string;
  created_at: string;
  tables: Record<string, { rows: number; files: string[] }>;
}

/** 備份內附的還原說明（放在每份備份的 README.txt）。 */
export function restoreReadme(appLabel: string, date: string, tables: readonly string[]): string {
  return [
    `${appLabel}備份 ${date}`,
    "",
    "內容：每個資料表一組 NDJSON 檔（每行一列 JSON），manifest.json 列出所有檔案與列數；manifest.json 最後才寫入，沒有它代表這份備份不完整，不要使用。",
    "只含依法或業務必須永久保存的資料；不含：Amway 資料、登入與授權的暫存資料、Token 與密碼的雜湊、圖檔與附件檔本體（檔案本來就在 R2）。",
    "",
    "還原步驟（需杜杜龍核准；正式資料的還原不可自行動手）：",
    "1. 先在測試環境還原並驗證，確認筆數與內容都對。",
    "2. 依 manifest.json 讀入各檔；每一列用 INSERT OR REPLACE 寫回同名資料表與同名欄位。",
    `3. 資料表：${tables.join("、")}。`,
    "4. 還原後請所有會員重新登入（登入資料本來就不在備份裡）。",
    "",
    "備份只存在 R2，不可放進公開程式庫、不可貼進對話或 Issue。",
  ].join("\n");
}

export interface BackupRunOpts {
  db: BackupDb;
  bucket: BackupBucket | undefined;
  appId: string;
  /** 還原說明裡的 App 名稱，例如「行動大學」。 */
  appLabel: string;
  tables: BackupTables;
  config: BackupConfig | null;
  now: Date;
  /** 失敗時呼叫（App 在這裡寫站內通知給超級管理員）；不可丟出例外。 */
  onFailure?: (info: { date: string; error: string }) => Promise<void>;
}

/**
 * 到了時間就備份；回傳備份的總列數（0＝沒到時間、功能關閉、沒有 R2、今天做過了，或失敗）。
 * 失敗時會先呼叫 onFailure、再把例外丟出（排程那層寫日誌）。
 */
export async function runWeeklyBackup(o: BackupRunOpts): Promise<number> {
  const { config, bucket } = o;
  if (!config?.enabled || !bucket || !isBackupWindow(config.weekday, o.now)) return 0;
  const { date } = taipeiNow(o.now);
  const folder = backupFolder(date);
  if (await bucket.head(folder + "manifest.json")) return 0; // 今天已經備份過
  try {
    const total = await exportBackup(o, folder, date);
    await pruneBackups(bucket, config.keep);
    return total;
  } catch (e) {
    await o.onFailure?.({ date, error: e instanceof Error ? e.name : "error" }).catch(() => undefined);
    throw e;
  }
}

async function pruneBackups(bucket: BackupBucket, keep: number): Promise<void> {
  const listed = await bucket.list({ prefix: BACKUP_PREFIX, delimiter: "/" });
  for (const folder of backupsToDelete(listed.delimitedPrefixes, keep)) {
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: folder, cursor });
      if (page.objects.length) await bucket.delete(page.objects.map((x) => x.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
}

/** 把 tables 列的資料匯出到 R2 的 folder（manifest.json 最後才寫）；每週備份與「還原前的安全備份」共用。回傳總列數。 */
export async function exportBackup(o: Pick<BackupRunOpts, "db" | "bucket" | "appId" | "appLabel" | "tables" | "now">, folder: string, label: string): Promise<number> {
  const { db, bucket } = o;
  if (!bucket) throw new Error("no_bucket");
  const manifest: BackupManifest = { version: 1, app: o.appId, created_at: o.now.toISOString(), tables: {} };
  let total = 0;
  for (const [table, cols] of Object.entries(o.tables)) {
    const files: string[] = [];
    let rows = 0;
    for (let offset = 0; ; offset += ROWS_PER_FILE) {
      const r = await db.prepare(`SELECT ${cols.join(", ")} FROM ${table} ORDER BY rowid LIMIT ? OFFSET ?`).bind(ROWS_PER_FILE, offset).all<Record<string, unknown>>();
      const list = r.results ?? [];
      if (!list.length && offset > 0) break;
      const name = `${table}.${files.length + 1}.ndjson`;
      await bucket.put(folder + name, list.map((x) => JSON.stringify(x)).join("\n"), { httpMetadata: { contentType: "application/x-ndjson" } });
      files.push(name);
      rows += list.length;
      if (list.length < ROWS_PER_FILE) break;
    }
    manifest.tables[table] = { rows, files };
    total += rows;
  }
  await bucket.put(folder + "README.txt", restoreReadme(o.appLabel, label, Object.keys(o.tables)), { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
  await bucket.put(folder + "manifest.json", JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });
  return total;
}
