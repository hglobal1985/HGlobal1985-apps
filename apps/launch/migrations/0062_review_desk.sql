-- 業主 2026-11-16：
-- ① 刪除「自動抓取 YouTube 影片畫面當封面」勾選：一律＝有手動上傳就用上傳的，沒有就用 YouTube 縮圖。舊資料的勾選全部清掉。
UPDATE courses SET auto_cover = 0;
UPDATE lessons SET auto_cover = 0;
-- ② 「費用與審核」的審核窗口：除了審核群組，還可以指定特定會員（邀請網址 24 小時有效）與指定身份（主辦中心的會長／音控／小編）。
ALTER TABLE courses ADD COLUMN review_roles TEXT NOT NULL DEFAULT '';
CREATE TABLE course_reviewers (
  course_id TEXT NOT NULL,
  member_sub TEXT NOT NULL,
  member_name TEXT NOT NULL DEFAULT '',
  added_by_sub TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (course_id, member_sub)
);
CREATE INDEX idx_course_reviewers_member ON course_reviewers(member_sub);
CREATE TABLE review_invites (
  token_hash TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  created_by_sub TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_by_sub TEXT,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
