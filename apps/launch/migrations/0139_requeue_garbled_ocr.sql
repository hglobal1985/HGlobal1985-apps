-- 文字辨識卡住重複輸出（一堆 "title:"）的照片：清掉亂碼，重新排隊辨識（業主 2026-11-26 回報）
UPDATE cover_media SET ocr_text = '', ocr_status = '', ocr_fields = '' WHERE kind = 'image' AND ocr_text LIKE '%title:%title:%title:%title:%';
