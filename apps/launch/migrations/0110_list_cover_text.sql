-- 清單封面：文字可疊在上傳的圖片上（業主 2026-11-22）。
-- cover_text＝自訂文字（空＝用清單名稱）；cover_text_on＝要不要顯示文字。
-- 以前「上傳圖片」封面沒有文字，所以舊的上傳封面一律關閉文字，外觀不變。
ALTER TABLE my_lists ADD COLUMN cover_text TEXT;
ALTER TABLE my_lists ADD COLUMN cover_text_on INTEGER NOT NULL DEFAULT 1;
UPDATE my_lists SET cover_text_on = 0 WHERE cover_mode = 'upload';
