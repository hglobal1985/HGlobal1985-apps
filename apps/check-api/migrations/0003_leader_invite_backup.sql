-- 組長邀請連結（杜杜龍 2026-11-27：先建好組別，再請各組組長發連結邀組員）：邀請可以指定是哪一組的組長。
ALTER TABLE invites ADD COLUMN group_id TEXT;

-- 作業檔案備份（杜杜龍 2026-11-27）：活動結束與刪除前通知（站內＋推播＋Email）；Email 只寄標記要寄的通知。
ALTER TABLE notices ADD COLUMN email INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notices ADD COLUMN emailed INTEGER NOT NULL DEFAULT 0;

-- 一鍵下載備份的壓縮檔下載憑證（1 小時有效）：scope＝mine（自己的作業）／all（全部，老師以上）；part＝第幾包。
CREATE TABLE zip_tickets (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  part INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
