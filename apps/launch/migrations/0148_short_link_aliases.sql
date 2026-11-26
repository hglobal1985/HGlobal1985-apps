-- 短網址改名後，舊縮寫要繼續有效（杜杜龍 2026-11-26：已經分享出去的網址不能失效，自動轉到現在的網址）。
CREATE TABLE IF NOT EXISTS short_link_aliases (
  slug TEXT PRIMARY KEY COLLATE NOCASE,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_short_link_aliases_target ON short_link_aliases (kind, value);
