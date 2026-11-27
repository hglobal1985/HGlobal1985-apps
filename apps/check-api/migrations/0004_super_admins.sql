-- 超級管理員名單（每週備份失敗要通知超級管理員；杜杜龍 2026-11-27）。
-- 超級管理員的身分在中央，這裡只記「最近以超級管理員身分使用過本 App 的會員代號」（不存姓名、信箱），排程失敗通知才找得到人。
-- 會員刪帳號（中央 member.deleted）時一併刪除。
CREATE TABLE super_admins (
  member_id TEXT PRIMARY KEY,
  seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
