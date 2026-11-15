-- 「完整版課程影片」改成手動勾選新增的真實一列（教材區塊最後一列）：lessons.is_full=1。
-- 課程設定的「顯示完整版」（courses.show_full）不再使用，欄位保留。
ALTER TABLE lessons ADD COLUMN is_full INTEGER NOT NULL DEFAULT 0;

-- 既有課程：原本自動顯示完整版的（同一支影片被切成多堂），轉成真實的一列，學員看到的不變。
INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type, media_ref, kind, is_full)
SELECT g.course_id || '-full' || g.n,
       g.course_id,
       g.maxpos + g.n,
       CASE WHEN g.total > 1 THEN '完整版課程影片 ' || g.n ELSE '完整版課程影片' END,
       g.minutes,
       g.media_type,
       g.media_ref,
       'material',
       1
FROM (
  SELECT l.course_id AS course_id,
         l.media_type AS media_type,
         l.media_ref AS media_ref,
         SUM(l.duration_minutes) AS minutes,
         (SELECT MAX(x.position) FROM lessons x WHERE x.course_id = l.course_id) AS maxpos,
         ROW_NUMBER() OVER (PARTITION BY l.course_id ORDER BY MIN(l.position)) AS n,
         COUNT(*) OVER (PARTITION BY l.course_id) AS total
  FROM lessons l JOIN courses c ON c.id = l.course_id
  WHERE c.show_full = 1 AND l.kind = 'chapter' AND l.media_ref IS NOT NULL AND l.media_type <> 'demo'
  GROUP BY l.course_id, l.media_type, l.media_ref
  HAVING SUM(CASE WHEN l.start_seconds IS NOT NULL OR l.end_seconds IS NOT NULL THEN 1 ELSE 0 END) > 0
) g;
