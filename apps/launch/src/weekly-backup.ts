/**
 * 行動大學每週備份（生態系統功能 4 weekly_backup，杜杜龍 2026-11-27；共用模組 packages/server-shared/src/weekly-backup.ts）。
 * 排程（每 10 分鐘）呼叫；中央設定的星期、台北 03:00 把永久資料匯出到 R2（bucket `learn`）的 backups/<日期>/，同一天只做一次。
 * 資料表與欄位明確列在 LAUNCH_BACKUP_TABLES；新資料表預設不備份，要備份就加進來並更新測試（tests/weekly-backup.test.ts 會檢查欄位真的存在、沒有敏感欄位）。
 * 不含：登入與暫存（sessions、各種 ticket、驗證用資料）、Google 雲端授權（drive_link）、書櫃密碼雜湊、課程邀請碼、推播訂閱、
 *   中央快取（member_profiles、member_contacts、central_snapshots）、統計與用量、搜尋向量與逐字稿、Amway 資料；圖檔與附件本體本來就在 R2。
 * 失敗時寫日誌並發站內通知給管理員（notifications，recipient_role = admin；推播照既有流程）。
 */
import { runWeeklyBackup, taipeiNow, type BackupBucket, type BackupConfig, type BackupDb } from "../../../packages/server-shared/src/weekly-backup.ts";
import { APP_ID, fetchEcoBackupConfig } from "./central.ts";
import type { Env } from "./d1.ts";

export const LAUNCH_BACKUP_TABLES: Readonly<Record<string, readonly string[]>> = {
  courses: ["id", "title", "subtitle", "teacher", "category", "price_twd", "min_rank_code", "theme", "status", "sort_order", "created_at", "updated_at", "description", "guidance_unit", "host_unit", "host_center_key", "free_from", "free_until", "review_group_id", "allow_president", "edm_key", "cover_key", "cover_bg_id", "art_version", "event_start", "event_end", "is_public", "price_tba", "edm_view_y", "hide_home", "location", "location_none", "diamond_free", "early_bird", "early_price_twd", "early_until", "series", "is_online", "show_full", "teacher_rank", "teacher_title", "chapter_covers", "cover_rect", "created_by_sub", "edited_by_name", "edited_at", "auto_cover", "center_course", "is_shorts", "url_name", "is_list", "review_roles", "view_scope", "hide_guests", "mat_url", "series_order", "use_brand_logo", "brand_id", "zone", "series_hidden", "no_speaker", "is_package", "invite_only", "block_photos"],
  course_runs: ["id", "course_id", "title", "starts_at", "location", "register_until", "capacity", "price_twd", "status", "created_at"],
  lessons: ["id", "course_id", "position", "title", "duration_minutes", "media_type", "media_ref", "start_seconds", "end_seconds", "run_id", "event_date", "sharer", "sharer_rank", "sharer_title", "cover_key", "poster_key", "art_version", "auto_cover", "kind", "is_full", "is_speaker", "is_summary", "brand_id", "categories", "in_sheet", "yt_checked_at", "link_block_id"],
  lesson_attachments: ["id", "lesson_id", "course_id", "name", "r2_key", "size", "content_type", "kind", "link_url", "att_type", "created_by", "created_at"],
  orders: ["id", "member_sub", "member_name_snapshot", "status", "total_twd", "reject_reason", "reviewed_by_sub", "reviewed_at", "created_at", "center_key", "center_label", "hglobal", "deferred", "paid_twd", "pay_method", "paid_at", "revoked_at", "legal_name", "pay_ref", "join_method"],
  order_items: ["order_id", "course_id", "title_snapshot", "price_twd", "run_id"],
  order_payments: ["id", "order_id", "method", "last5", "friend_name", "paid_at", "created_at"],
  order_events: ["id", "order_id", "actor_sub", "actor_name", "actor_title", "action", "reason_code", "message", "note", "created_at"],
  enrollments: ["member_sub", "course_id", "run_id", "source_order_id", "granted_at", "hidden"],
  course_comments: ["id", "course_id", "member_sub", "member_name", "body", "status", "hidden_by_sub", "created_at"],
  course_editors: ["center_key", "center_label", "member_sub", "member_name", "can_create", "can_edit_others", "can_delete_others", "added_by_sub", "created_at", "updated_at"],
  review_groups: ["id", "name", "owner_center_key", "owner_center_label", "created_by_sub", "created_at"],
  review_group_members: ["group_id", "center_key", "center_label", "member_sub", "member_name", "duty", "added_by_sub", "created_at"],
  review_log: ["id", "field_key", "field_label", "applicant_sub", "applicant_name", "from_text", "to_text", "status", "decided_by_sub", "decided_by_name", "created_at", "decided_at", "final_text"],
  achievements: ["id", "name", "description", "icon", "condition_type", "threshold", "course_id", "feature", "lesson_id", "active", "sort_order", "created_at", "difficulty", "unit", "series"],
  member_achievements: ["member_sub", "achievement_id", "earned_at"],
  learning_started: ["member_sub", "course_id", "hidden", "created_at"],
  lesson_progress: ["member_sub", "lesson_id", "course_id", "completed_at"],
  ranks: ["code", "name", "sort_order"],
  series_settings: ["series", "title", "show_in_all", "updated_at", "template"],
  my_lists: ["id", "owner_sub", "owner_name", "owner_avatar", "number", "title", "slug", "cover_item_id", "clicks", "position", "created_at", "show_rank", "cover_mode", "cover_key", "cover_bg_id", "cover_ver", "cover_text", "cover_text_on", "cover_color"],
  my_list_items: ["id", "list_id", "kind", "ref", "ref2", "note", "position", "created_at"],
  recipe_categories: ["id", "name", "position", "created_by", "created_at"],
  recipes: ["id", "title", "category_id", "body", "status", "author_sub", "author_name", "created_at", "updated_at", "number", "author_center_key", "author_center_label"],
  announcements: ["id", "body", "enabled", "position", "created_by", "created_at", "updated_at"],
  quotes: ["id", "body", "created_by", "created_at"],
};

/** 測試用：直接給設定（不連中央）。 */
export async function runLaunchBackup(env: Env, now: Date, config?: BackupConfig | null): Promise<number> {
  const cfg = config !== undefined ? config : taipeiNow(now).hour === 3 ? await fetchEcoBackupConfig() : null; // 只有台北 03 點才需要問中央（其他時間一定不備份）
  const db = env.DB;
  return runWeeklyBackup({
    db: db as unknown as BackupDb,
    bucket: env.MEDIA as unknown as BackupBucket | undefined,
    appId: APP_ID,
    appLabel: "行動大學",
    tables: LAUNCH_BACKUP_TABLES,
    config: cfg,
    now,
    onFailure: async ({ date }) => {
      await db
        .prepare("INSERT INTO notifications (id, recipient_sub, recipient_role, recipient_center_key, title, body, link) VALUES (?, NULL, 'admin', NULL, ?, ?, ?)")
        .bind(crypto.randomUUID(), "每週備份失敗", `${date} 的每週備份沒有完成，請盡快請開發人員檢查（備份只存在 R2，不會影響使用）。`, "/notices")
        .run();
    },
  });
}
