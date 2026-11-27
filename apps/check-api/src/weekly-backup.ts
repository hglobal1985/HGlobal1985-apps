/**
 * 寰宇繳作業系統每週備份（生態系統功能 4 weekly_backup，杜杜龍 2026-11-27；共用模組 packages/server-shared/src/weekly-backup.ts）。
 * 排程（每小時 07 分）呼叫；中央設定的星期、台北 03:00 點的那一次，把永久資料匯出到 R2（bucket `check`）的 backups/<日期>/，同一天只做一次。
 * 資料表與欄位明確列在 CHECK_BACKUP_TABLES；新資料表預設不備份（tests/weekly-backup.test.ts 會檢查欄位真的存在、沒有敏感欄位）。
 * 不含：登入與暫存（tickets、zip_tickets）、推播訂閱（push_subs）、邀請碼（invites）、中央快取（people）、通知與提醒紀錄、作業檔案本體（files 只備份中繼資料與文字內容，檔案本來就在 R2）。
 * 失敗時寫日誌；這個 App 沒有存「超級管理員」名單（只能用本人 Token 即時問中央），所以站內通知發給各活動的管理員（role = manager）。
 */
import { runWeeklyBackup, taipeiNow, type BackupBucket, type BackupConfig, type BackupDb } from "../../../packages/server-shared/src/weekly-backup.ts";
import { APP_ID, fetchEcoBackupConfig } from "./central.ts";
import { notify } from "./core.ts";
import type { Env } from "./env.ts";

export const CHECK_BACKUP_TABLES: Readonly<Record<string, readonly string[]>> = {
  activities: ["id", "title", "summary", "starts_on", "ends_on", "status", "join_approval", "late_allowed", "auto_remind", "peers_see_scores", "retention_until", "files_purged_at", "created_by", "created_at", "updated_at"],
  groups: ["id", "activity_id", "name", "position", "created_at"],
  lessons: ["id", "activity_id", "position", "title", "due_at", "created_at"],
  items: ["id", "activity_id", "lesson_id", "position", "name", "note", "mode", "per", "unit", "max_points", "min_count", "points", "full_score", "in_total", "kinds", "late_allowed", "created_at"],
  members: ["activity_id", "member_id", "role", "status", "group_id", "is_leader", "joined_at"],
  submissions: ["id", "item_id", "activity_id", "member_id", "status", "declared", "approved", "note", "points", "score", "stars", "comment", "leader_note", "graded_by", "graded_at", "submitted_at", "late", "updated_at"],
  files: ["id", "submission_id", "kind", "name", "r2_key", "url", "body", "content_type", "size", "position", "created_at"],
  comments: ["id", "submission_id", "member_id", "body", "hidden", "created_at"],
  reports: ["id", "activity_id", "target", "member_id", "reason", "resolved", "created_at"],
};

/** 測試用：直接給設定（不連中央）。 */
export async function runCheckBackup(env: Env, now: Date, config?: BackupConfig | null): Promise<number> {
  const cfg = config !== undefined ? config : taipeiNow(now).hour === 3 ? await fetchEcoBackupConfig() : null; // 只有台北 03 點才需要問中央（其他時間一定不備份）
  const db = env.DB;
  return runWeeklyBackup({
    db: db as unknown as BackupDb,
    bucket: env.FILES as unknown as BackupBucket | undefined,
    appId: APP_ID,
    appLabel: "繳作業系統",
    tables: CHECK_BACKUP_TABLES,
    config: cfg,
    now,
    onFailure: async ({ date }) => {
      const managers = (await db.prepare("SELECT DISTINCT member_id FROM members WHERE role = 'manager' AND status = 'active'").all<{ member_id: string }>()).results.map((r) => r.member_id);
      await notify(db, managers, "每週備份失敗", `${date} 的每週備份沒有完成，請盡快請開發人員檢查（備份只存在 R2，不會影響使用）。`, "/");
    },
  });
}
