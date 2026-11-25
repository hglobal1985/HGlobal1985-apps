-- 相簿照片（區塊照片）的文字辨識 OCR（業主 2026-11-25）：沿用 cover_media 既有的 ocr_status／ocr_text／ocr_model／ocr_at 欄位，不需新增欄位。
-- 只是補一個索引，讓背景排程快速找到「區塊照片、還沒辨識」的那幾張。
CREATE INDEX IF NOT EXISTS cover_media_photo_ocr_pending ON cover_media (owner_kind, kind, ocr_status);
