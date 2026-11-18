-- 教材檔案下載（業主 2026-11-18）：一律存 R2，下載經過「權限檢查＋一次性下載連結」；並記錄下載。
-- 取消舊的「業主雲端硬碟上傳」：上傳紀錄表刪除；授權通行證（drive_link）由排程撤銷並刪除後，再於之後的版本移除空表。
DROP TABLE IF EXISTS drive_uploads;
CREATE TABLE IF NOT EXISTS download_tickets (
  id TEXT PRIMARY KEY,           -- 一次性下載碼（隨機）
  att_id TEXT NOT NULL,
  member_sub TEXT NOT NULL,
  member_name TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_ip TEXT
);
CREATE TABLE IF NOT EXISTS material_downloads (
  id TEXT PRIMARY KEY,
  att_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  member_sub TEXT NOT NULL,
  member_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS material_downloads_member ON material_downloads (member_sub, created_at);
