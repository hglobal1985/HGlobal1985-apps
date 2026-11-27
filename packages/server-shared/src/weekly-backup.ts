/**
 * 每週備份（生態系統功能 4；串接指令 2026-11-27.5 三、18 (4)；伺服器共用模組，杜杜龍 2026-11-27）。
 * 兩個 App（行動大學、寰宇繳作業系統）共用：各自只提供「要備份哪些資料表與欄位」，其餘流程在這裡。
 *
 * 規則（照串接指令）：
 * - config.eco_features.weekly_backup 沒有或 enabled 為 false 就不備份；weekday（0＝星期日…6）的台北時間凌晨 3 點後才做，同一天只做一次。
 * - 只備份「依法或業務必須永久保存」的資料，明確列出資料表與欄位（新資料表預設不備份）。不含 Amway 資料、Token 與密碼雜湊、登入與暫存資料、圖檔本體。
 * - 存進 App 自己的 R2，路徑 backups/<台北日期>/：<表名>.<序號>.ndjson（每行一列 JSON，每檔最多 5000 列）、README.txt（還原說明）、
 *   manifest.json（列出所有檔案與列數，最後才寫入；沒有它代表不完整）。
 * - 寫完只留最近 keep 份（依日期），其餘刪除。
 * - 失敗要寫日誌並讓杜杜龍知道（站內通知給超級管理員，由各 App 的 onFailure 負責）。同一天只通知一次。
 */

/** 一張要備份的表：欄位要明確列出（不可用 *）；where 只能是固定的條件文字（不接受外部輸入）。 */
export type BackupTable = { table: string; columns: string[]; where?: string };

export type BackupConfig = { enabled: boolean; weekday: number; keep: number };

/** 最小的 R2 介面（Worker 的 R2Bucket 與測試用假的都符合）。 */
export type BackupBucket = {
  put(key: string, value: string): Promise<unknown>;
  head(key: string): Promise<unknown | null>;
  list(opts: { prefix?: string; delimiter?: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string }[]; delimitedPrefixes: string[]; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<unknown>;
};
/** 最小的 D1 介面。 */
export type BackupDb = {
  prepare(sql: string): { bind(...v: unknown[]): { all<T = Record<string, unknown>>(): Promise<{ results: T[] }> } };
};

export const BACKUP_ROWS_PER_FILE = 5000;
const notifiedDates = new Set<string>();
const IDENT = /^[a-z_][a-z0-9_]*$/;

/** 台北時間（UTC+8）的日期、星期、小時。 */
export function taipeiParts(ms: number): { date: string; weekday: number; hour: number } {
  const d = new Date(ms + 8 * 3600_000);
  return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay(), hour: d.getUTCHours() };
}

/** 從中央設定讀備份設定；讀不到、沒有欄位、格式不對一律視為不備份（fail closed）。 */
export async function fetchBackupConfig(central: string, appId: string, f: (u: string, i?: RequestInit) => Promise<Response>): Promise<BackupConfig | null> {
  try {
    const res = await f(`${central}/v1/apps/${appId}/config`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { config?: { eco_features?: { weekly_backup?: Partial<BackupConfig> } } };
    const w = body.config?.eco_features?.weekly_backup;
    if (!w || w.enabled !== true) return null;
    const weekday = Number(w.weekday);
    const keep = Number(w.keep);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !Number.isInteger(keep) || keep < 1 || keep > 52) return null;
    return { enabled: true, weekday, keep };
  } catch {
    return null;
  }
}

function readme(app: string, date: string, tables: BackupTable[]): string {
  return [
    `${app} 每週備份（${date}，台北時間）`,
    "",
    "內容：只有依法或業務必須永久保存的資料；不含 Amway 資料、Token 與密碼雜湊、登入與暫存資料、圖檔本體。",
    "格式：<表名>.<序號>.ndjson，每行一列 JSON（欄位名稱即資料表欄位），每檔最多 5000 列。",
    "完整性：manifest.json 最後才寫入，列出所有檔案與列數；沒有 manifest.json 代表這份備份不完整，不可用來還原。",
    "",
    "還原步驟：",
    "1. 先在測試環境（另建的測試資料庫）還原並核對列數與內容，確認無誤。",
    "2. 正式資料的還原必須經杜杜龍核准；沒有核准不可動正式資料庫。",
    "3. 這份檔案含個人資料，只能存在 App 自己的 R2，不放進公開程式庫、不貼進對話或 Issue。",
    "",
    "備份的資料表與欄位：",
    ...tables.map((t) => `- ${t.table}：${t.columns.join(", ")}${t.where ? `（條件：${t.where}）` : ""}`),
    "",
  ].join("\n");
}

export type BackupResult =
  | { status: "skipped"; reason: "disabled" | "not-today" | "too-early" | "too-late" | "done" | "failed-before" }
  | { status: "ok"; date: string; files: number; rows: number; pruned: number }
  | { status: "failed"; date: string };

/**
 * 排程呼叫（每次排程都可以呼叫，沒到時間就直接略過）：該備份的日子、台北 03:00～05:59 之間、今天還沒備份成功才做。
 * 失敗時寫 backups/<日期>/failed.json 標記並呼叫 onFailure（一天只通知一次），之後同一天的排程仍會重試，直到成功或過了 05:59。
 */
export async function runWeeklyBackup(opts: {
  db: BackupDb;
  bucket: BackupBucket;
  tables: BackupTable[];
  appName: string;
  config: BackupConfig | null;
  now?: number;
  onFailure?: (date: string) => Promise<void>;
}): Promise<BackupResult> {
  const cfg = opts.config;
  if (!cfg || !cfg.enabled) return { status: "skipped", reason: "disabled" };
  const t = taipeiParts(opts.now ?? Date.now());
  if (t.weekday !== cfg.weekday) return { status: "skipped", reason: "not-today" };
  if (t.hour < 3) return { status: "skipped", reason: "too-early" };
  if (t.hour >= 6) return { status: "skipped", reason: "too-late" };
  const base = `backups/${t.date}/`;
  if (await opts.bucket.head(`${base}manifest.json`)) return { status: "skipped", reason: "done" };
  try {
    const files: { name: string; table: string; rows: number }[] = [];
    for (const spec of opts.tables) {
      if (!IDENT.test(spec.table) || !spec.columns.length || !spec.columns.every((c) => IDENT.test(c))) throw new Error("bad table spec");
      const cols = spec.columns.map((c) => `"${c}"`).join(", ");
      let last = 0;
      let seq = 1;
      for (;;) {
        // 用 rowid 分段讀（不用 OFFSET，量大時才不會越讀越慢）
        const sql = `SELECT rowid AS "__rid", ${cols} FROM "${spec.table}" WHERE rowid > ?${spec.where ? ` AND (${spec.where})` : ""} ORDER BY rowid LIMIT ${BACKUP_ROWS_PER_FILE}`;
        const rows = (await opts.db.prepare(sql).bind(last).all<Record<string, unknown>>()).results;
        if (!rows.length) break;
        last = Number(rows[rows.length - 1]!.__rid);
        const name = `${spec.table}.${String(seq).padStart(3, "0")}.ndjson`;
        await opts.bucket.put(`${base}${name}`, rows.map((r) => JSON.stringify(Object.fromEntries(spec.columns.map((c) => [c, r[c] ?? null])))).join("\n") + "\n");
        files.push({ name, table: spec.table, rows: rows.length });
        seq++;
        if (rows.length < BACKUP_ROWS_PER_FILE) break;
      }
    }
    await opts.bucket.put(`${base}README.txt`, readme(opts.appName, t.date, opts.tables));
    // manifest 最後才寫：有它才代表這份備份完整
    await opts.bucket.put(`${base}manifest.json`, JSON.stringify({ date: t.date, app: opts.appName, files, total_rows: files.reduce((n, f) => n + f.rows, 0) }, null, 2));
    const pruned = await pruneBackups(opts.bucket, cfg.keep);
    return { status: "ok", date: t.date, files: files.length, rows: files.reduce((n, f) => n + f.rows, 0), pruned };
  } catch (e) {
    console.error("weekly backup failed", e instanceof Error ? e.message : "error"); // 日誌只寫原因，不寫資料
    // 一天只通知一次：看 R2 標記，並在記憶體也記一筆（R2 本身壞掉、寫不進標記時才不會每次排程都通知）
    const first = !notifiedDates.has(t.date) && !(await opts.bucket.head(`${base}failed.json`).catch(() => null));
    notifiedDates.add(t.date);
    await opts.bucket.put(`${base}failed.json`, JSON.stringify({ date: t.date })).catch(() => {});
    if (first) await opts.onFailure?.(t.date).catch(() => {});
    return { status: "failed", date: t.date };
  }
}

/** 只留最近 keep 份（依日期，不論完整與否都算一份日期資料夾；日期以外的路徑一律不碰）。回傳刪掉幾個檔案。 */
export async function pruneBackups(bucket: BackupBucket, keep: number): Promise<number> {
  const dates: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: "backups/", delimiter: "/", cursor });
    for (const p of page.delimitedPrefixes) {
      const m = /^backups\/(\d{4}-\d{2}-\d{2})\/$/.exec(p);
      if (m) dates.push(m[1]!);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const old = dates.sort().reverse().slice(Math.max(keep, 1));
  let deleted = 0;
  for (const d of old) {
    let c: string | undefined;
    do {
      const page = await bucket.list({ prefix: `backups/${d}/`, cursor: c });
      const keys = page.objects.map((o) => o.key);
      for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
      deleted += keys.length;
      c = page.truncated ? page.cursor : undefined;
    } while (c);
  }
  return deleted;
}
