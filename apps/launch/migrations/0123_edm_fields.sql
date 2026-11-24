-- EDM 辨識文字依「欄位格式」整理（業主 2026-11-24）：ocr_fields＝整理後的欄位（JSON）；ocr_fmt＝整理時用的格式版本（格式改了就會自動重新整理）。
ALTER TABLE cover_media ADD COLUMN ocr_fields TEXT NOT NULL DEFAULT '';
ALTER TABLE cover_media ADD COLUMN ocr_fmt TEXT NOT NULL DEFAULT '';
