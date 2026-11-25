-- 作業功能（業主 2026-11-25，第一個用在美力之星）：學員繳交作業、老師批改評分、學員分組。
-- 作業屬於某一門課（course_id）；只有這門課已開通（enrollments）的學員能交。檔案存 R2 的 hw/…，只用短效簽名網址讀取（不公開）。

-- 學員分組：每門課各自分組；組長、老師都可以編（組長只能編自己這組）。
CREATE TABLE IF NOT EXISTS hw_groups (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS hw_groups_course ON hw_groups (course_id, position);
CREATE TABLE IF NOT EXISTS hw_group_members (
  course_id TEXT NOT NULL,
  member_sub TEXT NOT NULL,
  group_id TEXT NOT NULL,
  is_leader INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (course_id, member_sub)
);
CREATE INDEX IF NOT EXISTS hw_group_members_group ON hw_group_members (group_id);

-- 作業：kinds＝學員可以交的種類（image,video,file,link,text，逗號分隔）；grading＝score（分數）／stars（5 顆星）／pass（通過或重交）。
CREATE TABLE IF NOT EXISTS hw_assignments (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  kinds TEXT NOT NULL DEFAULT 'image,video,file,link,text',
  grading TEXT NOT NULL DEFAULT 'score',
  max_score INTEGER NOT NULL DEFAULT 100,
  opens_at TEXT,
  due_at TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS hw_assignments_course ON hw_assignments (course_id, created_at);

-- 繳交：每位學員每份作業一筆。status：draft（還在放檔案、沒送出）／submitted（等待批改）／graded（已評分）／returned（退回重交）。
CREATE TABLE IF NOT EXISTS hw_submissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  member_sub TEXT NOT NULL,
  member_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  score INTEGER,
  stars INTEGER,
  passed INTEGER,
  comment TEXT NOT NULL DEFAULT '',
  graded_by_name TEXT NOT NULL DEFAULT '',
  graded_at TEXT,
  submitted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (assignment_id, member_sub)
);
CREATE INDEX IF NOT EXISTS hw_submissions_member ON hw_submissions (member_sub, updated_at);
CREATE INDEX IF NOT EXISTS hw_submissions_course ON hw_submissions (course_id, status);

-- 繳交的檔案與連結：kind＝image／video／file／link。
CREATE TABLE IF NOT EXISTS hw_files (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  r2_key TEXT,
  poster_key TEXT,
  link_url TEXT,
  content_type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS hw_files_submission ON hw_files (submission_id, position);

-- 留言：學員本人、組長、老師可以在一份繳交下面留言（評分只有老師）。
CREATE TABLE IF NOT EXISTS hw_comments (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  author_sub TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'student',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS hw_comments_submission ON hw_comments (submission_id, created_at);
