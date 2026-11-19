-- 套裝課程（業主 2026-11-19）：課程卡勾選後才能新增「區塊」，區塊功能與清單卡相同。
ALTER TABLE courses ADD COLUMN is_package INTEGER NOT NULL DEFAULT 0 CHECK (is_package IN (0, 1));

-- 「主題」（原主講人標記）：章節維持每門課一個；教材每個區塊一個，由程式控管，所以唯一索引只管章節。
DROP INDEX IF EXISTS lessons_one_speaker;
CREATE UNIQUE INDEX lessons_one_speaker ON lessons(course_id) WHERE is_speaker = 1 AND kind = 'chapter';
