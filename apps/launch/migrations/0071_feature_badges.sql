-- 「功能體驗」徽章（業主 2026-11-17，類似新手教學）：記錄會員用過哪些網站功能，並新增徽章條件 feature_used。
CREATE TABLE feature_uses (
  member_sub TEXT NOT NULL,
  feature TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  first_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (member_sub, feature)
);
-- 重建 achievements（放寬 CHECK、加 feature 欄位）；取得紀錄先備份再還原，避免連動刪除。
CREATE TABLE member_achievements_bak AS SELECT * FROM member_achievements;
CREATE TABLE achievements_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '🏅',
  condition_type TEXT NOT NULL CHECK (condition_type IN ('lessons_completed', 'courses_completed', 'courses_enrolled', 'learning_days', 'comments_posted', 'course_completed', 'streak_days', 'watch_minutes', 'centers_subscribed', 'series_subscribed', 'categories_explored', 'early_lessons', 'night_lessons', 'weekend_lessons', 'lessons_in_a_day', 'feature_used')),
  threshold INTEGER NOT NULL DEFAULT 1,
  course_id TEXT,
  feature TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO achievements_new (id, name, description, icon, condition_type, threshold, course_id, active, sort_order, created_at) SELECT id, name, description, icon, condition_type, threshold, course_id, active, sort_order, created_at FROM achievements;
DROP TABLE achievements;
ALTER TABLE achievements_new RENAME TO achievements;
DELETE FROM member_achievements;
INSERT OR IGNORE INTO member_achievements SELECT * FROM member_achievements_bak WHERE achievement_id IN (SELECT id FROM achievements);
DROP TABLE member_achievements_bak;
