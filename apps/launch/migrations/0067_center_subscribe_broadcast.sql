-- 中心訂閱與廣播公告（業主 2026-11-17）：訂閱的人在中心有新課程上架、管理員發廣播公告時收到通知。
CREATE TABLE IF NOT EXISTS center_subscriptions (
  member_sub TEXT NOT NULL,
  center_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (member_sub, center_key)
);
CREATE INDEX IF NOT EXISTS idx_center_subscriptions_center ON center_subscriptions(center_key);
CREATE TABLE IF NOT EXISTS center_broadcasts (
  id TEXT PRIMARY KEY,
  center_key TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  edited_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_center_broadcasts_center ON center_broadcasts(center_key, created_at);
CREATE TABLE IF NOT EXISTS center_broadcast_cfg (
  center_key TEXT PRIMARY KEY,
  seconds INTEGER NOT NULL DEFAULT 2
);
