-- 匯入工作（業主 2026-11-18）：YouTube 播放清單、封面圖、照片、連結、單支影片，由排程在背景依序匯入某份清單的某個區塊。
CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('playlist', 'video', 'cover', 'photo', 'link')),
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  start_sec INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  imported INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  done_at TEXT
);
CREATE INDEX idx_import_jobs_status ON import_jobs (status, seq);
