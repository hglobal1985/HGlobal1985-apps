-- EDM／相簿文字辨識改用 Llama 4 Scout（業主 2026-11-26：Llama 3.2 Vision 繁體中文錯字太多）。
-- 1) 已存的模型選擇若有這兩項，一律改成 Scout；2) 全部中心 EDM 圖重新排隊辨識（舊文字保留到新結果寫入為止，批次排程會陸續處理）。
UPDATE ui_settings SET value = json_set(value, '$.edm_vision', '@cf/meta/llama-4-scout-17b-16e-instruct', '$.photo_ocr', '@cf/meta/llama-4-scout-17b-16e-instruct') WHERE key = 'ai_models' AND json_valid(value);
UPDATE cover_media SET ocr_status = '' WHERE owner_kind = 'center' AND scope = 'edm' AND kind = 'image' AND ocr_status IN ('done', 'failed');
