-- 課程 EDM 併入中心 EDM 空間（業主 2026-11-23）：中心主辦、已發佈、有 EDM 的課程，其 EDM 圖會自動成為該中心 EDM 空間（cover_media，scope = 'edm'）裡的一張，
-- 用 course_id 綁定那堂課（一堂課只會有一張）。綁定的照片不能刪，只能「更換照片」（同時換掉那堂課的 EDM）。
ALTER TABLE cover_media ADD COLUMN course_id TEXT;
CREATE UNIQUE INDEX cover_media_course ON cover_media (course_id) WHERE course_id IS NOT NULL;
