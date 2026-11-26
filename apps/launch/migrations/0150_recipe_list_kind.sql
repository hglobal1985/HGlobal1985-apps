-- 「加入我的清單」可以放食譜（杜杜龍 2026-11-26）：my_list_items.kind 的檢查多一個 'recipe'（SQLite 不能直接改檢查條件，所以重建資料表，內容與索引原樣搬過去）。
PRAGMA defer_foreign_keys = on;
CREATE TABLE my_list_items_new (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES my_lists(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('course', 'lesson', 'series', 'center', 'recipe')),
  ref TEXT NOT NULL,
  ref2 TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO my_list_items_new (id, list_id, kind, ref, ref2, note, position, created_at) SELECT id, list_id, kind, ref, ref2, note, position, created_at FROM my_list_items;
DROP TABLE my_list_items;
ALTER TABLE my_list_items_new RENAME TO my_list_items;
CREATE UNIQUE INDEX idx_my_list_items_uq ON my_list_items(list_id, kind, ref);
CREATE INDEX idx_my_list_items_ref ON my_list_items(kind, ref);
