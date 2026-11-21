-- 「加入我的清單」（業主 2026-11-21）：會員自己建立的清單，同一個內容（課程卡、教材、系列卡、中心卡）可加入多份清單。
-- 所有清單一律公開（業主決定：沒有隱私設定）；分享網址＝/會員編號/自訂名稱（number＋slug）。
-- 點擊次數、人數（瀏覽器產生的匿名代碼，不記身分）與每天、各來源（LINE／Facebook…）的點擊另存。
CREATE TABLE my_lists (
  id TEXT PRIMARY KEY,
  owner_sub TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  owner_avatar TEXT NOT NULL DEFAULT '',
  number TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  cover_item_id TEXT,
  clicks INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_my_lists_owner ON my_lists(owner_sub);
CREATE UNIQUE INDEX idx_my_lists_slug ON my_lists(number, slug);

-- kind：course（課程卡）／lesson（單一教材或章節）／series／center；ref＝編號或名稱；ref2＝教材所屬課程編號；note＝個人備註。
CREATE TABLE my_list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES my_lists(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('course', 'lesson', 'series', 'center')),
  ref TEXT NOT NULL,
  ref2 TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX idx_my_list_items_uq ON my_list_items(list_id, kind, ref);
CREATE INDEX idx_my_list_items_ref ON my_list_items(kind, ref);

CREATE TABLE my_list_visitors (
  list_id TEXT NOT NULL REFERENCES my_lists(id) ON DELETE CASCADE,
  vid TEXT NOT NULL,
  PRIMARY KEY (list_id, vid)
);

-- 每天、每個來源（line／facebook／instagram／direct／other）的點擊次數（日期是台灣日期）。
CREATE TABLE my_list_hits (
  list_id TEXT NOT NULL REFERENCES my_lists(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  source TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (list_id, day, source)
);
