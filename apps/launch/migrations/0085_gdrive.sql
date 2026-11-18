-- Google 雲端硬碟上傳（業主 2026-11-18）：管理員在行動大學上傳的檔案，存進業主個人的雲端硬碟。
-- 單列（id=1）：業主授權一次後取得的長期通行證（refresh token），只在伺服器使用，不回傳給任何前端。
CREATE TABLE IF NOT EXISTS drive_link (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  refresh_token TEXT NOT NULL,
  account_email TEXT NOT NULL DEFAULT '',
  folder_id TEXT NOT NULL,
  folder_name TEXT NOT NULL DEFAULT '',
  connected_by TEXT NOT NULL,
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  broken INTEGER NOT NULL DEFAULT 0
);
-- 授權流程的一次性代碼（10 分鐘內有效、用過即刪），防止別人偽造回呼。
CREATE TABLE IF NOT EXISTS drive_oauth_state (
  state TEXT PRIMARY KEY,
  sub TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
-- 上傳紀錄：誰、什麼時候、傳了什麼（檔案本身只在雲端硬碟）。
CREATE TABLE IF NOT EXISTS drive_uploads (
  id TEXT PRIMARY KEY,
  member_sub TEXT NOT NULL,
  member_name TEXT NOT NULL DEFAULT '',
  center TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  file_id TEXT NOT NULL UNIQUE,
  web_link TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS drive_uploads_member ON drive_uploads (member_sub, created_at);
