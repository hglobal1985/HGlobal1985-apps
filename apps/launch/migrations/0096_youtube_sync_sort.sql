-- 同步 YouTube 清單的排序規則（業主 2026-11-20）：每份同步各自選；使用者手動調整過教材順序後自動鎖定，同步不再重排。
ALTER TABLE youtube_syncs ADD COLUMN sort_mode TEXT NOT NULL DEFAULT 'date_desc';
ALTER TABLE youtube_syncs ADD COLUMN sort_locked INTEGER NOT NULL DEFAULT 0;
