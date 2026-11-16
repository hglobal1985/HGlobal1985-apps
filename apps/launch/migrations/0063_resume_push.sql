-- 業主 2026-11-17：
-- ① 續播記憶：每位學員每一堂「最後播放到第幾秒」（影片本身的秒數；ratio 仍是看過的最大比例）。
ALTER TABLE lesson_watch ADD COLUMN position_sec REAL;
-- ② 手機推播通知（Web Push）：每個裝置一筆訂閱；role／roles／center_key 是訂閱當下的身份快照，用來送「給總部」「給某中心會長」的通知。
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  member_sub TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  roles TEXT NOT NULL DEFAULT '',
  center_key TEXT,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_push_member ON push_subscriptions(member_sub);
-- 每則站內通知是否已推播（0＝還沒；舊的通知一律視為已處理，不補推）。
ALTER TABLE notifications ADD COLUMN pushed INTEGER NOT NULL DEFAULT 0;
UPDATE notifications SET pushed = 1;
-- 開課前一天提醒：同一門課同一天只發一次。
CREATE TABLE course_reminders (
  course_id TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (course_id, day)
);
