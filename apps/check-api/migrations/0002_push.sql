-- 手機推播（Web Push；杜杜龍 2026-11-27）：每個裝置一筆訂閱；站內通知新增後背景推播，pushed 記錄推過沒。
CREATE TABLE push_subs (
  endpoint TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX push_subs_member ON push_subs (member_id);
ALTER TABLE notices ADD COLUMN pushed INTEGER NOT NULL DEFAULT 0;
