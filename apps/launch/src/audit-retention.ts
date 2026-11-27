/**
 * 稽核紀錄保存期限（杜杜龍 2026-11-27）：一般操作紀錄保存 3 個月，到期自動刪除。
 * 永久保留：付費相關（報名紀錄、繳費、取消、匯出、看本名等 order.*）與站內留言（comment.*）。
 * 排程每 10 分鐘跑一次，每次最多刪 2000 筆，量大時會分幾次刪完。
 */
import type { D1Database } from "./d1.ts";

export const AUDIT_RETENTION_DAYS = 90;

export async function pruneAuditLog(db: D1Database, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * 86400_000).toISOString();
  const r = await db
    .prepare(
      `DELETE FROM audit_log WHERE id IN (
         SELECT id FROM audit_log
         WHERE created_at < ? AND target_type NOT IN ('order', 'comment') AND action NOT LIKE 'order.%' AND action NOT LIKE 'comment.%'
         LIMIT 2000)`,
    )
    .bind(cutoff)
    .run();
  return r.meta?.changes ?? 0;
}

/**
 * 站內通知保存期限（杜杜龍 2026-11-27 授權 AI 決定）：已讀的通知保存半年、沒讀過的保存一年，到期自動刪除。
 * 永久保留：付費相關（連到報名紀錄 /orders、/admin/orders 的通知），與稽核紀錄「付費相關永久保留」一致。
 */
export const NOTICE_READ_DAYS = 180;
export const NOTICE_UNREAD_DAYS = 365;
export async function pruneNotifications(db: D1Database, now = new Date()): Promise<number> {
  const readCut = new Date(now.getTime() - NOTICE_READ_DAYS * 86400_000).toISOString();
  const unreadCut = new Date(now.getTime() - NOTICE_UNREAD_DAYS * 86400_000).toISOString();
  const r = await db
    .prepare(
      `DELETE FROM notifications WHERE id IN (
         SELECT id FROM notifications
         WHERE link NOT LIKE '/orders%' AND link NOT LIKE '/admin/orders%'
           AND ((read_at IS NOT NULL AND created_at < ?) OR created_at < ?)
         LIMIT 2000)`,
    )
    .bind(readCut, unreadCut)
    .run();
  return r.meta?.changes ?? 0;
}
