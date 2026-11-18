-- 品牌 Logo（業主 2026-11-18）：後台上傳／更換 logo，每個 logo 可選底圖或底色，並對應到分類標籤；課程與素材可勾選「使用品牌 logo 作為封面」。
CREATE TABLE brand_logos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo_key TEXT,
  bg_key TEXT,
  bg_color TEXT,
  categories TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  art_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
ALTER TABLE courses ADD COLUMN use_brand_logo INTEGER NOT NULL DEFAULT 0;
