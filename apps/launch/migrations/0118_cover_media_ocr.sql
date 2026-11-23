-- EDM 圖片辨識（業主 2026-11-23）：中心 EDM 的每張圖由 Workers AI 視覺模型辨識文字與活動日期，供搜尋與依活動日期排序。
-- ocr_status：''＝還沒辨識（背景會慢慢處理）、'done'＝完成、'working'＝處理中（超過 10 分鐘沒完成會重來）、'failed'＝辨識失敗（不再自動重試）。
ALTER TABLE cover_media ADD COLUMN ocr_text TEXT NOT NULL DEFAULT '';
ALTER TABLE cover_media ADD COLUMN event_date TEXT;
ALTER TABLE cover_media ADD COLUMN ocr_status TEXT NOT NULL DEFAULT '';
ALTER TABLE cover_media ADD COLUMN ocr_model TEXT NOT NULL DEFAULT '';
ALTER TABLE cover_media ADD COLUMN ocr_at TEXT;
CREATE INDEX cover_media_ocr_pending ON cover_media(owner_kind, scope, ocr_status);
