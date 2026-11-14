-- 課程頁原地編輯、小編、中心 EDM、中心短網址（業主 2026-11-14）。

-- 課程建立者（小編「自己新增的課程」用）與最後修改者（顯示在編輯模式的進階設定）。
ALTER TABLE courses ADD COLUMN created_by_sub TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN edited_by_name TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN edited_at TEXT;
-- 舊課程：從稽核紀錄找回建立者（找不到就留空，算「別人的」課程）。
UPDATE courses SET created_by_sub = COALESCE((SELECT a.actor_sub FROM audit_log a WHERE a.target_id = courses.id AND a.action IN ('course.create', 'course.duplicate') ORDER BY a.created_at LIMIT 1), '');

-- 小編：各中心的音控、會長（或總部）指派同中心的會員；身分只存在行動大學。
-- 三種權限各自開關：新增（自己新增的課程有完整權限）、修改別人、刪除別人（下架封存）。
CREATE TABLE course_editors (
  center_key TEXT NOT NULL,
  center_label TEXT NOT NULL,
  member_sub TEXT NOT NULL,
  member_name TEXT NOT NULL DEFAULT '',
  can_create INTEGER NOT NULL DEFAULT 1,
  can_edit_others INTEGER NOT NULL DEFAULT 0,
  can_delete_others INTEGER NOT NULL DEFAULT 0,
  added_by_sub TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (center_key, member_sub)
);
CREATE INDEX idx_course_editors_member ON course_editors(member_sub);

-- 中心 EDM（全部課程頁選了中心才顯示）。center_key 為中心名稱的正規化（centerKey），名稱以會員中心為準。
CREATE TABLE center_art (
  center_key TEXT PRIMARY KEY,
  center_label TEXT NOT NULL,
  edm_key TEXT NOT NULL,
  art_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 短網址加上「中心」。
CREATE TABLE short_links_new (
  slug TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('category', 'series', 'center')),
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (kind, value)
);
INSERT INTO short_links_new (slug, kind, value, created_at) SELECT slug, kind, value, created_at FROM short_links;
DROP TABLE short_links;
ALTER TABLE short_links_new RENAME TO short_links;
