-- 成就產生器（業主 2026-11-22）：新增「量化單位」欄位 unit，並新增條件 files_downloaded（下載教材檔案數）。
-- 重建 achievements：之後新增條件類型不再需要改資料庫的 CHECK（類型由程式驗證）。取得紀錄先備份再還原，避免連動刪除。
CREATE TABLE member_achievements_bak AS SELECT * FROM member_achievements;
CREATE TABLE achievements_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '🏅',
  condition_type TEXT NOT NULL,
  threshold INTEGER NOT NULL DEFAULT 1,
  course_id TEXT,
  feature TEXT,
  lesson_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  difficulty INTEGER NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 3),
  unit TEXT
);
INSERT INTO achievements_new (id, name, description, icon, condition_type, threshold, course_id, feature, lesson_id, active, sort_order, created_at, difficulty) SELECT id, name, description, icon, condition_type, threshold, course_id, feature, lesson_id, active, sort_order, created_at, difficulty FROM achievements;
DROP TABLE achievements;
ALTER TABLE achievements_new RENAME TO achievements;
DELETE FROM member_achievements;
INSERT OR IGNORE INTO member_achievements SELECT * FROM member_achievements_bak WHERE achievement_id IN (SELECT id FROM achievements);
DROP TABLE member_achievements_bak;
