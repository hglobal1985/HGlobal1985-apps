-- 把「新品上市培訓」的 9 份獨立清單＋「安麗特惠直播」的 2 份清單，合併成一份清單「安麗新品與特惠直播培訓」，
-- 原本每份清單變成一個區塊（lessons.kind = 'section'，勾「顯示在上拉選單」、品牌＝對應的品牌 logo）；教材原封不動搬進區塊。
-- 舊網址與分享連結不保留（業主 2026-11-18：內部封測階段）。沒有這些課程的資料庫（本機、測試）整份是空操作。
CREATE TABLE _blk_map (src TEXT PRIMARY KEY, blk INTEGER NOT NULL, rnk INTEGER NOT NULL, title TEXT, brand TEXT);
INSERT INTO _blk_map (src, blk, rnk, title, brand) VALUES
  ('cxnfbadr', 1, 1, '紐崔萊 Nutrilite', 'bd884u6q'),
  ('cg62efp8', 1, 2, NULL, NULL),
  ('cnkku4e7', 2, 1, '雅姿 Artistry', 'b26uchsx'),
  ('cdjzzqt2', 2, 2, NULL, NULL),
  ('c72bhch8', 3, 1, '益之源 eSpring', 'bgcbhead'),
  ('cch8v8nq', 4, 1, '逸新 ATMOSPHERE', 'brb6uv89'),
  ('cpc4f55j', 5, 1, '美護髮 satinique', 'bew7qjy8'),
  ('cn6pdq6a', 6, 1, '口腔保健 glister', NULL),
  ('cndh7man', 7, 1, '個人護理 g&h', NULL),
  ('cpfvzcwu', 8, 1, '運動營養 XS', 'bs2pa2x5'),
  ('cbpyt7u9', 9, 1, '家庭清潔 Home', NULL);
-- 只有目標清單存在才動作
DELETE FROM _blk_map WHERE NOT EXISTS (SELECT 1 FROM courses WHERE id = 'cxnfbadr') OR src NOT IN (SELECT id FROM courses);
-- 舊的分類標題（例如「個人護理」裡的「短影音」）併入區塊，不另外保留
DELETE FROM lessons WHERE kind = 'section' AND course_id IN (SELECT src FROM _blk_map);
-- 區塊標題列（沿用原清單自己上傳的封面）
INSERT INTO lessons (id, course_id, position, title, kind, brand_id, categories, in_sheet, media_type, cover_key, art_version)
SELECT 'blk-' || m.src, 'cxnfbadr', m.blk * 10000, m.title, 'section', m.brand, '', 1, 'demo', c.cover_key, c.art_version
FROM _blk_map m JOIN courses c ON c.id = m.src WHERE m.title IS NOT NULL;
-- 教材搬進目標清單：區塊 × 來源順序 × 原本的順序
UPDATE lessons SET position = (SELECT m.blk * 10000 + m.rnk * 1000 FROM _blk_map m WHERE m.src = lessons.course_id) + position, course_id = 'cxnfbadr'
WHERE course_id IN (SELECT src FROM _blk_map) AND kind <> 'section';
UPDATE lesson_attachments SET course_id = 'cxnfbadr' WHERE lesson_id IN (SELECT id FROM lessons WHERE course_id = 'cxnfbadr') AND course_id <> 'cxnfbadr';
-- 順序重新編成 1、2、3…（先把新編號存進輔助表，再一次寫回；舊順位都 ≥ 10000，不會互相撞到）
CREATE TABLE _ord AS SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS rn FROM lessons WHERE course_id = 'cxnfbadr' AND EXISTS (SELECT 1 FROM _blk_map);
UPDATE lessons SET position = (SELECT rn FROM _ord WHERE _ord.id = lessons.id) WHERE id IN (SELECT id FROM _ord);
DROP TABLE _ord;
-- 其餘清單刪除（教材都已搬走）
DELETE FROM courses WHERE id IN (SELECT src FROM _blk_map WHERE src <> 'cxnfbadr');
-- 目標清單改名、改系列
UPDATE courses SET title = '安麗新品與特惠直播培訓', series = '安麗新品與特惠直播培訓', series_order = 0, category = '', brand_id = NULL
WHERE id = 'cxnfbadr' AND EXISTS (SELECT 1 FROM _blk_map);
-- 系列封面沿用「新品上市培訓」的；系列點閱數相加
UPDATE series_art SET series = '安麗新品與特惠直播培訓' WHERE series = '新品上市培訓' AND EXISTS (SELECT 1 FROM _blk_map);
DELETE FROM series_art WHERE series = '安麗特惠直播' AND EXISTS (SELECT 1 FROM _blk_map);
INSERT OR REPLACE INTO page_views (kind, key, total)
SELECT 'series', '安麗新品與特惠直播培訓', SUM(total) FROM page_views WHERE kind = 'series' AND key IN ('新品上市培訓', '安麗特惠直播') AND EXISTS (SELECT 1 FROM _blk_map) HAVING COUNT(*) > 0;
DELETE FROM page_views WHERE kind = 'series' AND key IN ('新品上市培訓', '安麗特惠直播') AND EXISTS (SELECT 1 FROM _blk_map);
DROP TABLE _blk_map;
