-- 我的清單封面：會員不能再上傳封面圖，改選管理員的底圖或單色（業主 2026-11-22）。
-- cover_color＝選的單色（#RRGGBB，空＝預設森林綠）；原本用「上傳圖片」封面的清單改成自訂封面（文字＋預設底色）。
ALTER TABLE my_lists ADD COLUMN cover_color TEXT;
UPDATE my_lists SET cover_mode = 'text', cover_text_on = 1 WHERE cover_mode = 'upload';
