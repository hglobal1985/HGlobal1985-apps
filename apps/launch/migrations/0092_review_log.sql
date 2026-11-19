-- 獎銜／中心申請的紀錄（業主 2026-11-19）：送出申請與審核結果都留底，不隨審核完成而從通知頁消失。
-- 只記欄位名稱、申請的新內容（獎銜代碼或中心名稱）與結果，用來顯示「已處理的申請」與通知申請人。
CREATE TABLE review_log (
  id TEXT PRIMARY KEY,
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL,
  applicant_sub TEXT,
  applicant_name TEXT NOT NULL DEFAULT '',
  from_text TEXT NOT NULL DEFAULT '',
  to_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by_sub TEXT,
  decided_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at TEXT
);
CREATE INDEX review_log_status ON review_log(status, created_at);
CREATE INDEX review_log_applicant ON review_log(applicant_sub, created_at);
