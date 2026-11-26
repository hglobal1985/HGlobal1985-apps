-- 食譜照片只做場景辨識、不做文字辨識（杜杜龍 2026-11-26）：文字辨識狀態標成 skip，排程與待辨識張數都不算它們。
UPDATE cover_media SET ocr_status = 'skip' WHERE owner_kind = 'course' AND owner_key LIKE 'rcp:%';
