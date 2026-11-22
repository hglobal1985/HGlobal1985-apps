-- 我的清單預設封面改成「文字封面」（業主 2026-11-22）：還沒有自己指定過封面的舊清單（沒選內容封面、沒上傳圖片）一律改成文字封面。
UPDATE my_lists SET cover_mode = 'text' WHERE cover_mode = 'item' AND cover_item_id IS NULL AND cover_key IS NULL;
