/**
 * 備份還原（生態系統功能 4 的後台還原按鈕；伺服器共用模組，杜杜龍 2026-11-27）。
 * 流程：列出備份 → 預覽（只讀，不動資料）→ 還原。還原正式資料須杜杜龍核准，所以呼叫端必須：
 *   ① 只給超級管理員；② 要求輸入備份日期當確認字樣（confirm）；③ 寫稽核紀錄（不含資料內容）。
 * 安全設計：
 *   - 還原前自動把「現況」匯出到 R2 的 backups/pre-restore-<時間>/（不會被每週備份的清理刪掉），出錯就整個中止、不動資料。
 *   - 只「補寫與覆蓋」備份裡有的列（先 UPDATE、再 INSERT OR IGNORE 補回，不用 INSERT OR REPLACE，避免觸發連鎖刪除）；備份之後新增的資料不會被刪。
 *   - 只還原呼叫端明確列出的資料表與欄位；備份檔裡多出來的資料表或欄位一律拒絕。
 *   - 沒有主鍵的資料表不還原（預覽會標示）。
 */
import { BACKUP_DATE, BACKUP_PREFIX, backupFolder, exportBackup, type BackupBucket, type BackupDb, type BackupManifest, type BackupTables } from "./weekly-backup.ts";

export interface RestoreStmt { bind(...values: unknown[]): RestoreStmt }
export interface RestoreDb extends BackupDb {
  prepare(sql: string): { bind(...values: unknown[]): { all<T = Record<string, unknown>>(): Promise<{ results?: T[] }> } } & RestoreStmt;
  batch(stmts: unknown[]): Promise<{ meta?: { changes?: number } }[]>;
}
export interface RestoreBucket extends BackupBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export const PRE_RESTORE_PREFIX = `${BACKUP_PREFIX}pre-restore-`;
export const RESTORE_BATCH = 50;
const FILE_NAME = /^[a-z0-9_]+\.\d+\.ndjson$/;

export interface BackupListItem { date: string; created_at: string; rows: number }

/** 列出有完整 manifest.json 的備份（新到舊）。 */
export async function listBackups(bucket: RestoreBucket): Promise<BackupListItem[]> {
  const listed = await bucket.list({ prefix: BACKUP_PREFIX, delimiter: "/" });
  const out: BackupListItem[] = [];
  for (const f of listed.delimitedPrefixes) {
    const date = f.slice(BACKUP_PREFIX.length).replace(/\/$/, "");
    if (!BACKUP_DATE.test(date)) continue;
    const m = await readManifest(bucket, date).catch(() => null);
    if (m) out.push({ date, created_at: m.created_at, rows: Object.values(m.tables).reduce((n, t) => n + t.rows, 0) });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export async function readManifest(bucket: RestoreBucket, date: string): Promise<BackupManifest | null> {
  if (!BACKUP_DATE.test(date)) return null;
  const obj = await bucket.get(backupFolder(date) + "manifest.json");
  if (!obj) return null;
  const m = JSON.parse(await obj.text()) as BackupManifest;
  return m && m.version === 1 && typeof m.tables === "object" && m.tables ? m : null;
}

export interface RestorePlanTable { table: string; rows: number; files: string[]; pk: string[]; supported: boolean }
export interface RestorePlan { date: string; created_at: string; tables: RestorePlanTable[]; problems: string[] }

/** 預覽：檢查備份與目前資料表結構對得上（資料表／欄位／主鍵），不動任何資料。 */
export async function planRestore(db: RestoreDb, bucket: RestoreBucket, tables: BackupTables, date: string): Promise<RestorePlan | null> {
  const m = await readManifest(bucket, date);
  if (!m) return null;
  const plan: RestorePlan = { date, created_at: m.created_at, tables: [], problems: [] };
  for (const [table, info] of Object.entries(m.tables)) {
    const cols = tables[table];
    if (!cols) { plan.problems.push(`備份裡有不在清單內的資料表：${table}`); continue; }
    if (!info.files.every((f) => FILE_NAME.test(f) && f.startsWith(table + "."))) { plan.problems.push(`${table} 的檔名不正確`); continue; }
    const pk = await primaryKey(db, table);
    plan.tables.push({ table, rows: info.rows, files: info.files, pk, supported: pk.length > 0 });
    if (!pk.length) plan.problems.push(`${table} 沒有主鍵，不會還原`);
  }
  return plan;
}

async function primaryKey(db: RestoreDb, table: string): Promise<string[]> {
  const r = await db.prepare(`PRAGMA table_info(${table})`).bind().all<{ name: string; pk: number }>();
  return (r.results ?? []).filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
}

export interface RestoreOpts {
  db: RestoreDb;
  bucket: RestoreBucket | undefined;
  appId: string;
  appLabel: string;
  tables: BackupTables;
  date: string;
  /** 使用者輸入的確認字樣，必須等於備份日期。 */
  confirm: string;
  now: Date;
}
/** restored＝成功寫回（更新或補回）的列數；not_restored＝既不能更新、也補不回的列數（這些列的必填欄位不在備份清單內，例如活動加入代碼；要人工處理）。 */
export interface RestoreResult { pre_restore: string; restored: Record<string, number>; not_restored: Record<string, number>; skipped: string[] }

/** 還原；任何檢查不過都丟 Error（message 是給呼叫端判斷的代碼），沒有動資料。 */
export async function runRestore(o: RestoreOpts): Promise<RestoreResult> {
  if (!o.bucket) throw new Error("no_bucket");
  if (o.confirm !== o.date) throw new Error("confirm_mismatch");
  const plan = await planRestore(o.db, o.bucket, o.tables, o.date);
  if (!plan) throw new Error("backup_not_found");
  if (plan.problems.some((p) => !p.endsWith("不會還原"))) throw new Error("backup_mismatch");
  // 先讀完所有備份檔並驗證（任何一檔壞掉就中止，還沒動資料）。
  const loaded: { table: string; pk: string[]; rows: Record<string, unknown>[] }[] = [];
  for (const t of plan.tables.filter((x) => x.supported)) {
    const allowed = new Set(o.tables[t.table]);
    const rows: Record<string, unknown>[] = [];
    for (const f of t.files) {
      const obj = await o.bucket.get(backupFolder(o.date) + f);
      if (!obj) throw new Error("backup_incomplete");
      for (const line of (await obj.text()).split("\n")) {
        if (!line) continue;
        const row = JSON.parse(line) as Record<string, unknown>;
        if (Object.keys(row).some((k) => !allowed.has(k))) throw new Error("backup_mismatch");
        rows.push(row);
      }
    }
    if (rows.length !== t.rows) throw new Error("backup_incomplete");
    loaded.push({ table: t.table, pk: t.pk, rows });
  }
  // 還原前先備份現況；失敗就整個中止。
  const stamp = o.now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  const pre = `${PRE_RESTORE_PREFIX}${stamp}/`;
  await exportBackup(o as Required<Pick<RestoreOpts, "appId" | "appLabel" | "tables" | "now">> & { db: BackupDb; bucket: BackupBucket }, pre, `還原前 ${stamp}`);
  const restored: Record<string, number> = {};
  const notRestored: Record<string, number> = {};
  for (const { table, pk, rows } of loaded) {
    const cols = o.tables[table]!;
    const nonPk = cols.filter((c) => !pk.includes(c));
    // 先更新還在的列，再補回已不存在的列。不用 INSERT OR REPLACE（會觸發連鎖刪除）；補回用 OR IGNORE，
    // 因為有些必填欄位（例如加入代碼）刻意不在備份清單內，補不回的列只計數、不讓整批失敗。
    const upd = nonPk.length ? `UPDATE ${table} SET ${nonPk.map((c) => `${c} = ?`).join(", ")} WHERE ${pk.map((c) => `${c} = ?`).join(" AND ")}` : null;
    const ins = `INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    restored[table] = 0;
    notRestored[table] = 0;
    for (let i = 0; i < rows.length; i += RESTORE_BATCH) {
      const chunk = rows.slice(i, i + RESTORE_BATCH);
      const stmts: unknown[] = [];
      for (const r of chunk) {
        const v = (c: string) => r[c] ?? null;
        if (upd) stmts.push(o.db.prepare(upd).bind(...nonPk.map(v), ...pk.map(v)));
        stmts.push(o.db.prepare(ins).bind(...cols.map(v)));
      }
      const res = await o.db.batch(stmts);
      const per = upd ? 2 : 1;
      for (let k = 0; k < chunk.length; k++) {
        const changed = (res[k * per]?.meta?.changes ?? 0) > 0 || (upd ? (res[k * per + 1]?.meta?.changes ?? 0) > 0 : false);
        if (changed) restored[table]!++;
        else if (!upd && (res[k * per]?.meta?.changes ?? 0) === 0) restored[table]!++; // 只有主鍵欄的表：已存在就算還原
        else notRestored[table]!++;
      }
    }
  }
  return { pre_restore: pre.slice(0, -1), restored, not_restored: notRestored, skipped: plan.tables.filter((x) => !x.supported).map((x) => x.table) };
}
