-- 清單的「區塊」（業主 2026-11-18）：原本的分類標題（lessons.kind = 'section'）升級成區塊：
-- 可勾「顯示在上拉選單」、有自己的封面（沿用 lessons.cover_key）、分類（可複選）與品牌（單選）。
ALTER TABLE lessons ADD COLUMN brand_id TEXT;
ALTER TABLE lessons ADD COLUMN categories TEXT NOT NULL DEFAULT '';
ALTER TABLE lessons ADD COLUMN in_sheet INTEGER NOT NULL DEFAULT 1;
