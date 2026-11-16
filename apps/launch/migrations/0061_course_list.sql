-- 「素材清單」（業主 2026-11-16）：新增教材時可選「新增清單（影片／檔案）」；清單只有「其他教材」一種內容，
-- 沒有章節、時間地點、費用、主講人。is_list=1 的課程，影片教材在 App 內播放並計入學習進度（同章節）。
ALTER TABLE courses ADD COLUMN is_list INTEGER NOT NULL DEFAULT 0;
-- 業主指示：把「美力之星」與「認識寰宇」（業主稱「寰宇文化」）兩個系列的課程整個轉成清單：
-- 章節改成教材（影片來源、學習紀錄、課程網址都保留；主講人、地點等舊資料留在資料庫只是不再顯示）。
UPDATE courses SET is_list = 1, is_public = 1, price_twd = 0, price_tba = 0 WHERE series IN ('美力之星', '認識寰宇');
UPDATE lessons SET kind = 'material', is_speaker = 0, is_summary = 0
  WHERE kind = 'chapter' AND course_id IN (SELECT id FROM courses WHERE is_list = 1);
