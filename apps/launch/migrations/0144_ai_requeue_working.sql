-- 業主 2026-11-26：Scout 回傳物件造成程式錯誤，辨識卡在「處理中」；程式已修，這裡把卡住的重新排隊。
UPDATE cover_media SET ocr_status = '' WHERE kind = 'image' AND ocr_status = 'working';
UPDATE cover_media SET scene_status = '' WHERE kind = 'image' AND scene_status = 'working';
