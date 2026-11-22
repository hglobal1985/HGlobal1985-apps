-- 我的清單封面（業主 2026-11-22）：封面可以是內容封面、自己上傳的圖片、或「清單名稱的文字封面」＋管理員上傳的清單專用底圖。
CREATE TABLE list_cover_bgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  image_key TEXT NOT NULL,
  art_version INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
ALTER TABLE my_lists ADD COLUMN cover_mode TEXT NOT NULL DEFAULT 'item';
ALTER TABLE my_lists ADD COLUMN cover_key TEXT;
ALTER TABLE my_lists ADD COLUMN cover_bg_id TEXT;
ALTER TABLE my_lists ADD COLUMN cover_ver INTEGER NOT NULL DEFAULT 0;
