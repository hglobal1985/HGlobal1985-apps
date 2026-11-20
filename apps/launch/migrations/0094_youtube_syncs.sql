-- 同步 YouTube 清單（業主 2026-11-20）：存下播放清單網址與要放進的教材卡，超級管理員手動按「同步」就把新影片匯成教材。
CREATE TABLE youtube_syncs (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  playlist_id TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title_prefix TEXT NOT NULL DEFAULT '',
  last_synced_at TEXT,
  last_imported INTEGER NOT NULL DEFAULT 0,
  last_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_youtube_syncs_course ON youtube_syncs (course_id);
