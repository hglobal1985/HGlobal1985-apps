/**
 * 行動大學的每週備份（生態系統功能 4；串接指令 2026-11-27.5 三、18 (4)；杜杜龍 2026-11-27）。
 * 流程在共用模組 packages/server-shared/src/weekly-backup.ts；這裡只決定「備份哪些資料表與欄位」。
 * 只備份依法或業務必須永久保存的資料（與稽核紀錄、站內通知的永久保留規則一致）：
 * 報名紀錄（含繳費、審核事件、開通）、站內留言、付費相關稽核紀錄與通知。
 * 不備份（新資料表預設不備份）：Amway 資料、Token／工作階段、登入暫存、課程與教材內容、圖檔本體、統計與快取。
 */
import { runWeeklyBackup, type BackupBucket, type BackupDb, type BackupResult, type BackupTable } from "../../../packages/server-shared/src/weekly-backup.ts";
import { backupConfig } from "./central.ts";
import { notify } from "./core/base.ts";
import type { D1Database } from "./d1.ts";

export const BACKUP_TABLES: BackupTable[] = [
  {
    table: "orders",
    columns: ["id", "member_sub", "member_name_snapshot", "status", "total_twd", "reject_reason", "reviewed_by_sub", "reviewed_at", "created_at", "center_key", "center_label", "hglobal", "deferred", "paid_twd", "pay_method", "paid_at", "revoked_at", "legal_name", "pay_ref", "join_method"],
  },
  { table: "order_items", columns: ["order_id", "course_id", "title_snapshot", "price_twd", "run_id"] },
  { table: "order_payments", columns: ["id", "order_id", "method", "last5", "friend_name", "paid_at", "created_at"] },
  { table: "order_events", columns: ["id", "order_id", "actor_sub", "actor_name", "actor_title", "action", "reason_code", "message", "note", "created_at"] },
  { table: "enrollments", columns: ["member_sub", "course_id", "source_order_id", "granted_at", "hidden"] },
  { table: "course_comments", columns: ["id", "course_id", "member_sub", "member_name", "body", "status", "hidden_by_sub", "created_at"] },
  // 稽核紀錄：只備份「永久保留」的那兩類（付費相關與留言），其餘 3 個月後本來就會刪除。
  {
    table: "audit_log",
    columns: ["id", "actor_sub", "action", "target_type", "target_id", "detail", "created_at"],
    where: "target_type IN ('order', 'comment') OR action LIKE 'order.%' OR action LIKE 'comment.%'",
  },
  // 站內通知：只備份「永久保留」的付費相關通知。
  {
    table: "notifications",
    columns: ["id", "recipient_sub", "recipient_role", "title", "body", "link", "read_at", "created_at"],
    where: "link LIKE '/orders%' OR link LIKE '/admin/orders%'",
  },
];

/** 排程呼叫：沒到備份時間或中央沒開啟就直接略過；失敗時通知全體超級管理員（站內通知，沒有任何備份內容）。 */
export async function weeklyBackup(env: { DB: D1Database; MEDIA?: unknown }, now?: number): Promise<BackupResult> {
  if (!env.MEDIA) return { status: "skipped", reason: "disabled" };
  const config = await backupConfig();
  return runWeeklyBackup({
    db: env.DB as unknown as BackupDb,
    bucket: env.MEDIA as BackupBucket,
    tables: BACKUP_TABLES,
    appName: "行動大學",
    config,
    now,
    onFailure: async (date) => {
      await notify(env.DB, { role: "admin" }, "每週備份失敗", `${date} 的每週備份沒有完成，系統會在當天凌晨再試；若一直失敗請查看 Worker 日誌。`, "/").run();
    },
  });
}
