-- 從 Google 雲端硬碟匯入教材時的轉存進度（畫面每秒查一次顯示進度條）：只存已轉存的大小，完成就刪除。
CREATE TABLE IF NOT EXISTS import_progress (
  id TEXT PRIMARY KEY,
  member_sub TEXT NOT NULL,
  written INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
