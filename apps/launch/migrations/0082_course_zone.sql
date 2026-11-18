-- 專區欄位（業主 2026-11-18）：''＝依類型預設（課程→寰宇課程活動與素材專區、清單→安麗素材專區）。
ALTER TABLE courses ADD COLUMN zone TEXT NOT NULL DEFAULT '';
