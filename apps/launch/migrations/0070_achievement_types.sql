-- 徽章條件類型擴充（業主 2026-11-17：條件要多樣、連續性最多 7 天）：重建 achievements 表放寬 CHECK。
-- 舊徽章整批重做，所以先清掉取得紀錄（避免重建資料表時的連動刪除出意外）。
DELETE FROM member_achievements;
CREATE TABLE achievements_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '🏅',
  condition_type TEXT NOT NULL CHECK (condition_type IN ('lessons_completed', 'courses_completed', 'courses_enrolled', 'learning_days', 'comments_posted', 'course_completed', 'streak_days', 'watch_minutes', 'centers_subscribed', 'series_subscribed', 'categories_explored', 'early_lessons', 'night_lessons', 'weekend_lessons', 'lessons_in_a_day')),
  threshold INTEGER NOT NULL DEFAULT 1,
  course_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO achievements_new SELECT id, name, description, icon, condition_type, threshold, course_id, active, sort_order, created_at FROM achievements;
DROP TABLE achievements;
ALTER TABLE achievements_new RENAME TO achievements;
