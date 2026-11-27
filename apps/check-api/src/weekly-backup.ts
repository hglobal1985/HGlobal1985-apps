/**
 * 寰宇繳作業系統的每週備份（生態系統功能 4；串接指令 2026-11-27.5 三、18 (4)；杜杜龍 2026-11-27）。
 * 流程在共用模組 packages/server-shared/src/weekly-backup.ts；這裡只決定「備份哪些資料表與欄位」。
 * 只備份必須永久保存的成績資料：活動、成員與分組、堂、作業項目、繳交的結果（狀態、分數、評語）。
 * 不備份（新資料表預設不備份）：繳交的檔案與圖檔本體（依保存期限自動刪除）、留言、檢舉、邀請與下載憑證、通知、顯示名稱副本、推播訂閱、webhook 去重。
 */
import { runWeeklyBackup, type BackupBucket, type BackupDb, type BackupResult, type BackupTable } from "../../../packages/server-shared/src/weekly-backup.ts";
import { backupConfig } from "./central.ts";
import type { Env } from "./env.ts";

export const BACKUP_TABLES: BackupTable[] = [
  { table: "activities", columns: ["id", "title", "summary", "starts_on", "ends_on", "status", "join_code", "join_approval", "late_allowed", "auto_remind", "peers_see_scores", "retention_until", "files_purged_at", "created_by", "created_at", "updated_at"] },
  { table: "members", columns: ["activity_id", "member_id", "role", "status", "group_id", "is_leader", "joined_at"] },
  { table: "groups", columns: ["id", "activity_id", "name", "position", "join_code", "created_at"] },
  { table: "lessons", columns: ["id", "activity_id", "position", "title", "due_at", "created_at"] },
  { table: "items", columns: ["id", "activity_id", "lesson_id", "position", "name", "note", "mode", "per", "unit", "max_points", "min_count", "points", "full_score", "in_total", "kinds", "late_allowed", "created_at"] },
  { table: "submissions", columns: ["id", "item_id", "activity_id", "member_id", "status", "declared", "approved", "note", "points", "score", "stars", "comment", "leader_note", "graded_by", "graded_at", "submitted_at", "late", "updated_at"] },
];

/** 超級管理員（最近 180 天用過本 App 的）的會員代號。 */
async function recentSuperAdmins(env: Env): Promise<string[]> {
  const since = new Date(Date.now() - 180 * 86400_000).toISOString();
  return (await env.DB.prepare("SELECT member_id FROM super_admins WHERE seen_at >= ?").bind(since).all<{ member_id: string }>()).results.map((r) => r.member_id);
}

/** 排程呼叫：沒到備份時間或中央沒開啟就直接略過；失敗時通知超級管理員（站內通知，沒有任何備份內容）。 */
export async function weeklyBackup(env: Env, notify: (ids: string[], title: string, body: string, link: string) => Promise<void>, now?: number): Promise<BackupResult> {
  if (!env.FILES) return { status: "skipped", reason: "disabled" };
  return runWeeklyBackup({
    db: env.DB as unknown as BackupDb,
    bucket: env.FILES as unknown as BackupBucket,
    tables: BACKUP_TABLES,
    appName: "寰宇繳作業系統",
    config: await backupConfig(),
    now,
    onFailure: async (date) => notify(await recentSuperAdmins(env), "每週備份失敗", `${date} 的每週備份沒有完成，系統會在當天凌晨再試；若一直失敗請查看 Worker 日誌。`, "/"),
  });
}
