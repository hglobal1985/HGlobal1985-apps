-- 新增職稱要同步寫入中央會員系統的「待送清單」（只存待送的字串，不當詞庫使用、不顯示）。
-- 中央送成功就刪除；中央還沒提供「新增職稱」API 或暫時失敗就保留，之後儲存課程／章節時自動補送。
CREATE TABLE job_title_outbox (
  value TEXT PRIMARY KEY,
  tries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
