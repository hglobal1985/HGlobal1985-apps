-- 使用統計排除管理員操作（業主 2026-11-23）：每筆多一欄 admin（1＝管理員／我本人的操作，預設統計不含）。
-- 業主同意舊資料清掉重來（舊資料沒有分開記，分不出哪些是本人操作）。
DROP TABLE usage_stats;
CREATE TABLE usage_stats (
  day TEXT NOT NULL,
  hour INTEGER NOT NULL,
  device TEXT NOT NULL,
  os TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  admin INTEGER NOT NULL DEFAULT 0,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hour, device, os, kind, target, admin)
);
-- 管理員用過的網路位置（業主 2026-11-23 同意）：只存加密後的比對碼（不可還原成 IP），30 天沒再用管理員登入就失效；
-- 用來把「同一個網路、未登入或無痕」的操作也認成本人。
CREATE TABLE usage_owner_nets (
  hash TEXT PRIMARY KEY,
  seen_at TEXT NOT NULL
);
