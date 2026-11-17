-- 中央資料的「最近一次成功」快照（業主 2026-11-17）：中心清單的正本仍是會員中心；
-- 這裡只存最近一次成功取得的副本，讓沒登入的訪客（只能看公開課程）也看得到「所有中心」清單，不會一片空白。
CREATE TABLE central_snapshots (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
