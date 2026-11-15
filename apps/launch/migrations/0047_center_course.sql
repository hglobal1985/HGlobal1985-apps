-- 「中心課程」：只在「寰宇教育中心」頁出現，不在「全部課程」（相同系列／單元）出現；兩頁內容互不重複。
-- 各中心的音控、小編建立的課程強制是中心課程；總部管理員建立的預設不是（可勾選）。
ALTER TABLE courses ADD COLUMN center_course INTEGER NOT NULL DEFAULT 0;
-- 目前確定是中心課程的三門（美國洛杉磯中心）。
UPDATE courses SET center_course = 1 WHERE id IN ('cqdcuhkw', 'c2ynhjv5', 'cme2ugp5');
