-- 「寰宇文化」＝「認識寰宇」系列的 4 份清單合併成一份清單（業主 2026-11-18），原本每份變成一個區塊（做法同 0079），放在寰宇專區。
-- 「寰宇文化」＝「認識寰宇」系列的 4 份清單合併成一份清單，原本每份變成一個區塊（做法同 0079）；
-- 放在「寰宇課程活動與素材專區」。沒有這些清單的資料庫（本機、測試）整段是空操作。
CREATE TABLE _blk_map (src TEXT PRIMARY KEY, blk INTEGER NOT NULL, title TEXT);
INSERT INTO _blk_map (src, blk, title) VALUES
  ('c6z2uf6f', 1, '寰宇人才秀'),
  ('c8qzjkh8', 2, '王老師（事業篇）'),
  ('cvjtgdfu', 3, '王老師（生活篇）'),
  ('ccwvuttt', 4, '寰宇大會花絮回顧');
DELETE FROM _blk_map WHERE src NOT IN (SELECT id FROM courses);
DELETE FROM _blk_map WHERE NOT EXISTS (SELECT 1 FROM courses WHERE id = 'c6z2uf6f');
DELETE FROM lessons WHERE kind = 'section' AND course_id IN (SELECT src FROM _blk_map);
INSERT INTO lessons (id, course_id, position, title, kind, categories, in_sheet, media_type, cover_key, art_version)
SELECT 'blk-' || m.src, 'c6z2uf6f', m.blk * 10000, m.title, 'section', '', 1, 'demo', c.cover_key, c.art_version
FROM _blk_map m JOIN courses c ON c.id = m.src;
UPDATE lessons SET position = (SELECT m.blk * 10000 FROM _blk_map m WHERE m.src = lessons.course_id) + position, course_id = 'c6z2uf6f'
WHERE course_id IN (SELECT src FROM _blk_map) AND kind <> 'section';
UPDATE lesson_attachments SET course_id = 'c6z2uf6f' WHERE lesson_id IN (SELECT id FROM lessons WHERE course_id = 'c6z2uf6f') AND course_id <> 'c6z2uf6f';
CREATE TABLE _ord AS SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS rn FROM lessons WHERE course_id = 'c6z2uf6f' AND EXISTS (SELECT 1 FROM _blk_map);
UPDATE lessons SET position = (SELECT rn FROM _ord WHERE _ord.id = lessons.id) WHERE id IN (SELECT id FROM _ord);
DROP TABLE _ord;
-- 舊清單被別的紀錄（報名開通、報名明細）參照：能併到目標清單的併過去，其餘刪掉（清單類別本來就不能報名）。
UPDATE OR IGNORE enrollments SET course_id = 'c6z2uf6f' WHERE course_id IN (SELECT src FROM _blk_map WHERE src <> 'c6z2uf6f');
DELETE FROM enrollments WHERE course_id IN (SELECT src FROM _blk_map WHERE src <> 'c6z2uf6f');
UPDATE OR IGNORE order_items SET course_id = 'c6z2uf6f' WHERE course_id IN (SELECT src FROM _blk_map WHERE src <> 'c6z2uf6f');
DELETE FROM order_items WHERE course_id IN (SELECT src FROM _blk_map WHERE src <> 'c6z2uf6f');
DELETE FROM courses WHERE id IN (SELECT src FROM _blk_map WHERE src <> 'c6z2uf6f');
UPDATE courses SET title = '寰宇文化', series = '寰宇文化', series_order = 0, category = '', brand_id = NULL, zone = 'hglobal'
WHERE id = 'c6z2uf6f' AND EXISTS (SELECT 1 FROM _blk_map);
UPDATE series_art SET series = '寰宇文化' WHERE series = '認識寰宇' AND EXISTS (SELECT 1 FROM _blk_map);
UPDATE page_views SET key = '寰宇文化' WHERE kind = 'series' AND key = '認識寰宇' AND EXISTS (SELECT 1 FROM _blk_map);
DROP TABLE _blk_map;
