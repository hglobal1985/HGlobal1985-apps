-- 同步 Google 雲端資料夾（杜杜龍 2026-11-26）：貼資料夾連結，手動按「同步」（或每週自動）把資料夾裡的檔案匯成教材；
-- 教材只存 Drive 連結（檔案留在 Drive，不複製到 R2）。仿「同步 YouTube 清單」。
CREATE TABLE drive_syncs (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL DEFAULT '',
  title_format TEXT NOT NULL DEFAULT '{標題}',
  last_synced_at TEXT,
  last_imported INTEGER NOT NULL DEFAULT 0,
  last_total INTEGER NOT NULL DEFAULT 0,
  last_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_drive_syncs_course ON drive_syncs (course_id);
