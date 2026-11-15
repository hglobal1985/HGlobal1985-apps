-- 「自動使用 YouTube 影片畫面當封面」：課程、章節各一個勾選（預設不勾；沒有任何封面時一律自動用 YouTube 縮圖當臨時封面，不需要勾）。
ALTER TABLE courses ADD COLUMN auto_cover INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lessons ADD COLUMN auto_cover INTEGER NOT NULL DEFAULT 0;
