-- 區塊相簿的子資料夾（業主 2026-11-26，照互動示意）：區塊相簿底下最多一層子資料夾；沒分資料夾的照片是「未分類」（folder_id＝''）。
-- album_folders.owner_key＝區塊相簿的照片鍵（cover_media.owner_key，連結區塊用來源區塊）；同一個區塊內名稱不可重複。
CREATE TABLE IF NOT EXISTS album_folders (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_key, name)
);
CREATE INDEX IF NOT EXISTS album_folders_owner ON album_folders (owner_key);
ALTER TABLE cover_media ADD COLUMN folder_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS cover_media_folder ON cover_media (owner_key, folder_id);
