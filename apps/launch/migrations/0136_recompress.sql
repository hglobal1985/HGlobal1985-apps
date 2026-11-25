-- 站內舊照片依「相簿存檔格式與畫質」重新壓縮（業主 2026-11-25）：逐張處理的進度。
-- recompress：''＝還沒處理、'done'＝已重新壓縮、'skip'＝已經是目標格式或再壓沒有變小（維持原樣）、'fail'＝失敗（不再自動重試）。
-- bytes_before：重新壓縮前的大小（統計節省的空間用）。
ALTER TABLE cover_media ADD COLUMN recompress TEXT NOT NULL DEFAULT '';
ALTER TABLE cover_media ADD COLUMN bytes_before INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS cover_media_recompress ON cover_media (recompress, kind);
