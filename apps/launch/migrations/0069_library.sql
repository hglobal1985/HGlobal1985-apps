-- 「我的圖書館」（業主 2026-11-17）：會員個人專屬頁面，網址 /安麗會員編號，不出現在行動大學任何清單與搜尋。
-- 只有超級管理員用邀請網址指定的會員才有；圖書館與每一本書（項目）都可以各自設定密碼與幾天後失效。
CREATE TABLE libraries (
  member_sub TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,        -- 網址用的會員編號（小寫英數與短橫線）
  owner_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  pw_hash TEXT,                       -- 進入整座圖書館的密碼（PBKDF2）
  pw_salt TEXT,
  pw_expires_at TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE library_items (
  id TEXT PRIMARY KEY,
  library_sub TEXT NOT NULL,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('shelf', 'book')),   -- shelf＝書架（分類標題，可收合），book＝一本書（影片、簡報、PDF、連結）
  title TEXT NOT NULL,
  url TEXT,
  att_type TEXT,
  event_date TEXT,
  start_seconds INTEGER,
  end_seconds INTEGER,
  pw_hash TEXT,                       -- 單獨這本書的密碼
  pw_salt TEXT,
  pw_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_library_items ON library_items(library_sub, position);
-- 超級管理員指定圖書館擁有者用的邀請網址（24 小時、一次有效；對方登入後按接受）。
CREATE TABLE library_invites (
  code TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
