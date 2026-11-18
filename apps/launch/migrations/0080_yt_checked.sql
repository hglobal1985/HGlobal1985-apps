-- YouTube 教材的影片長度與發布日期，由伺服器排程用 YouTube 官方 API 補齊（業主 2026-11-18）。
-- 每個教材只檢查一次（讀不到也記錄，不重複查）；連結換掉時清空重查。
ALTER TABLE lessons ADD COLUMN yt_checked_at TEXT;
