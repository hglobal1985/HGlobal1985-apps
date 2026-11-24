-- 「實戰百寶箱」統一更名為「成交百寶箱」（業主 2026-11-24）：課程名稱、系列名稱（連同系列封面／設定／短網址／點閱／成就／手動排序）、品牌卡的連結區塊名稱。
UPDATE courses SET title = '成交百寶箱' WHERE title = '實戰百寶箱';
UPDATE courses SET series = '成交百寶箱' WHERE series = '實戰百寶箱';
UPDATE OR REPLACE series_settings SET series = '成交百寶箱' WHERE series = '實戰百寶箱';
UPDATE OR REPLACE series_art SET series = '成交百寶箱' WHERE series = '實戰百寶箱';
UPDATE OR REPLACE short_links SET value = '成交百寶箱' WHERE kind = 'series' AND value = '實戰百寶箱';
UPDATE OR REPLACE page_views SET key = '成交百寶箱' WHERE kind = 'series' AND key = '實戰百寶箱';
UPDATE keywords SET value = '成交百寶箱' WHERE kind = 'series' AND value = '實戰百寶箱' AND NOT EXISTS (SELECT 1 FROM keywords WHERE kind = 'series' AND value = '成交百寶箱');
UPDATE achievements SET series = '成交百寶箱' WHERE series = '實戰百寶箱';
UPDATE lessons SET title = '成交百寶箱' WHERE id LIKE '%-treasure';
UPDATE ui_settings SET value = replace(value, 's:實戰百寶箱', 's:成交百寶箱') WHERE key = 'ui_config';
