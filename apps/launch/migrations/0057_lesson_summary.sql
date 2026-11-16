-- 章節「總結與銷售課程」標記：同一門課最多一堂，用於「全部課程 > 單元」的篩選；與主講人互斥（由 API 強制）。
ALTER TABLE lessons ADD COLUMN is_summary INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX lessons_one_summary ON lessons(course_id) WHERE is_summary = 1;
