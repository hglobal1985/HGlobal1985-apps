-- 課程專屬網址改名後，舊網址要繼續有效（業主 2026-11-17：主講人改了網址要跟著改；之前分享出去的舊連結不能失效）。
CREATE TABLE IF NOT EXISTS course_url_aliases (
  scope TEXT NOT NULL,                       -- 主辦中心代碼；總部課程用空字串
  url_name TEXT NOT NULL COLLATE NOCASE,
  course_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (scope, url_name)
);
CREATE INDEX IF NOT EXISTS idx_course_url_aliases_course ON course_url_aliases(course_id);
