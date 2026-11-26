-- 業主 2026-11-26 回報 EDM 文字辨識一直 0 張：原因是站內圖片存成 AVIF，AI 視覺模型讀不了（corrupt image data）；
-- 相簿照片 OCR 另外因為選了這個帳號不能用的 Gemma 3 而全部失敗。程式已改成先轉 JPEG 再送，這裡把模型改回 Llama 4 Scout，並把失敗／卡住的全部重新排隊。
UPDATE ui_settings SET value = json_set(value, '$.photo_ocr', '@cf/meta/llama-4-scout-17b-16e-instruct') WHERE key = 'ai_models' AND json_valid(value);
UPDATE cover_media SET ocr_status = '' WHERE kind = 'image' AND ocr_status IN ('failed', 'working');
UPDATE cover_media SET scene_status = '' WHERE kind = 'image' AND scene_status IN ('failed', 'working');
