-- 「素材影片」徽章（業主 2026-11-19）：從「安麗官方素材專區」「安麗品牌專區」的每個區塊隨機挑 1～2 支影片，
-- 讀完（看完）一支就解鎖一枚徽章。新增徽章條件 material_video 與指定影片欄位 lesson_id；徽章圖固定用安麗 A 圖示（icon = '@amway'）。
-- 重建 achievements（放寬 CHECK、加 lesson_id）；取得紀錄先備份再還原，避免連動刪除。
CREATE TABLE member_achievements_bak AS SELECT * FROM member_achievements;
CREATE TABLE achievements_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '🏅',
  condition_type TEXT NOT NULL CHECK (condition_type IN ('lessons_completed', 'courses_completed', 'courses_enrolled', 'learning_days', 'comments_posted', 'course_completed', 'streak_days', 'watch_minutes', 'centers_subscribed', 'series_subscribed', 'categories_explored', 'early_lessons', 'night_lessons', 'weekend_lessons', 'lessons_in_a_day', 'feature_used', 'subscriptions_total', 'material_video')),
  threshold INTEGER NOT NULL DEFAULT 1,
  course_id TEXT,
  feature TEXT,
  lesson_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  difficulty INTEGER NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 3)
);
INSERT INTO achievements_new (id, name, description, icon, condition_type, threshold, course_id, feature, active, sort_order, created_at, difficulty) SELECT id, name, description, icon, condition_type, threshold, course_id, feature, active, sort_order, created_at, difficulty FROM achievements;
DROP TABLE achievements;
ALTER TABLE achievements_new RENAME TO achievements;
DELETE FROM member_achievements;
INSERT OR IGNORE INTO member_achievements SELECT * FROM member_achievements_bak WHERE achievement_id IN (SELECT id FROM achievements);
DROP TABLE member_achievements_bak;
