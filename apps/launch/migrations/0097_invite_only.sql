-- 指定邀請制（業主 2026-11-20）：課程勾「指定邀請制」後不看獎銜、一律人工審核；可另設邀請碼（明碼），輸入正確的人免審核直接開通。
ALTER TABLE courses ADD COLUMN invite_only INTEGER NOT NULL DEFAULT 0;
ALTER TABLE courses ADD COLUMN invite_code TEXT NOT NULL DEFAULT '';
-- 報名方式：空＝一般；invite＝輸入邀請碼加入；invite_request＝按「無邀請碼」申請（待人工審核，免費課程也要審核）。
ALTER TABLE orders ADD COLUMN join_method TEXT NOT NULL DEFAULT '';
-- 輸錯邀請碼的次數：連續 5 次鎖 10 分鐘。
CREATE TABLE IF NOT EXISTS invite_attempts (
  member_sub TEXT NOT NULL,
  course_id TEXT NOT NULL,
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  PRIMARY KEY (member_sub, course_id)
);
