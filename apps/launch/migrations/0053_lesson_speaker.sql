-- 章節「主講人」標記：同一門課最多一堂（用於「全部課程 > 單元」的「只顯示主講人」）。
ALTER TABLE lessons ADD COLUMN is_speaker INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX lessons_one_speaker ON lessons(course_id) WHERE is_speaker = 1;

-- 章節日期預設「跟著課程日期」：event_date 為空＝等於課程日期。把原本剛好與課程日期相同的章節改成「跟著」。
UPDATE lessons SET event_date = NULL
WHERE kind = 'chapter' AND event_date IS NOT NULL
  AND event_date = (SELECT c.event_start FROM courses c WHERE c.id = lessons.course_id);
