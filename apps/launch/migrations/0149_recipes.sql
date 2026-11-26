-- 食譜專區（杜杜龍 2026-11-26）：一道食譜＝名稱＋分類＋多張照片＋一篇純文字（文字裡獨立一行的 YouTube 網址會變成影片卡片）。
-- 照片沿用相簿的 cover_media（owner_kind='course'、owner_key='rcp:食譜編號'），不另建圖片表。
-- status：draft＝編輯中（還沒按儲存，列表看不到）、pending＝會員投稿待審核、published＝已發佈。
CREATE TABLE IF NOT EXISTS recipe_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO recipe_categories (id, name, position) VALUES ('western', '西式', 0), ('chinese', '中式', 1), ('soup', '湯品', 2), ('dessert', '點心', 3), ('drink', '飲品', 4);
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  category_id TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'published')),
  author_sub TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS recipes_status ON recipes (status, updated_at);
CREATE INDEX IF NOT EXISTS recipes_author ON recipes (author_sub, status);
