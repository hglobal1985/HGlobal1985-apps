-- 系列範本（業主 2026-11-20）：系列最後一次「套用到全系列課程」的設定值（JSON）；之後在這個系列新增課程，預設沿用這些值。
ALTER TABLE series_settings ADD COLUMN template TEXT NOT NULL DEFAULT '{}';
