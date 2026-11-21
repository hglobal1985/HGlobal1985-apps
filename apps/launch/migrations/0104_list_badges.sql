-- 「我的清單」成就（業主 2026-11-21）：新增條件 lists_created（累計建立清單數）、list_people（單一清單被點閱的人數），
-- 並新增 4 枚功能體驗徽章（建立／加入／分享／複製清單）與 4 枚清單徽章。
-- 重建 achievements（放寬 CHECK）；取得紀錄先備份再還原，避免連動刪除。
CREATE TABLE member_achievements_bak AS SELECT * FROM member_achievements;
CREATE TABLE achievements_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '🏅',
  condition_type TEXT NOT NULL CHECK (condition_type IN ('lessons_completed', 'courses_completed', 'courses_enrolled', 'learning_days', 'comments_posted', 'course_completed', 'streak_days', 'watch_minutes', 'centers_subscribed', 'series_subscribed', 'categories_explored', 'early_lessons', 'night_lessons', 'weekend_lessons', 'lessons_in_a_day', 'feature_used', 'subscriptions_total', 'material_video', 'lists_created', 'list_people')),
  threshold INTEGER NOT NULL DEFAULT 1,
  course_id TEXT,
  feature TEXT,
  lesson_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  difficulty INTEGER NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 3)
);
INSERT INTO achievements_new (id, name, description, icon, condition_type, threshold, course_id, feature, lesson_id, active, sort_order, created_at, difficulty) SELECT id, name, description, icon, condition_type, threshold, course_id, feature, lesson_id, active, sort_order, created_at, difficulty FROM achievements;
DROP TABLE achievements;
ALTER TABLE achievements_new RENAME TO achievements;
DELETE FROM member_achievements;
INSERT OR IGNORE INTO member_achievements SELECT * FROM member_achievements_bak WHERE achievement_id IN (SELECT id FROM achievements);
DROP TABLE member_achievements_bak;

INSERT INTO achievements (id, name, description, icon, condition_type, threshold, feature, sort_order, difficulty) VALUES
  ('ach-feat-list_create', '清單新手', '第一次建立自己的清單', '📋', 'feature_used', 1, 'list_create', 22, 1),
  ('ach-feat-list_add', '收進清單', '第一次把內容加入自己的清單', '📥', 'feature_used', 1, 'list_add', 23, 1),
  ('ach-feat-list_share', '清單推廣員', '第一次分享自己的清單', '📣', 'feature_used', 1, 'list_share', 24, 1),
  ('ach-feat-list_copy', '好清單大家用', '第一次複製朋友分享的清單', '🤝', 'feature_used', 1, 'list_copy', 25, 1);
INSERT INTO achievements (id, name, description, icon, condition_type, threshold, sort_order, difficulty) VALUES
  ('ach-lists-3', '清單收藏家', '累計建立 3 份清單', '🗂️', 'lists_created', 3, 900, 2),
  ('ach-list-people-10', '人氣清單', '你的清單被 10 位不同的人點開過', '🌟', 'list_people', 10, 901, 2),
  ('ach-list-people-50', '超人氣清單', '你的清單被 50 位不同的人點開過', '🏆', 'list_people', 50, 902, 3),
  ('ach-lists-5', '整理大師', '累計建立 5 份清單', '🧰', 'lists_created', 5, 903, 3);
