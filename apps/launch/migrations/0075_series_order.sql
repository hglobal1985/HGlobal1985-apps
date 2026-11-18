-- 素材系列內的手動排序（業主 2026-11-18）：超級管理員在系列頁用上下箭頭調整；0＝還沒排過（依原本順序）。
ALTER TABLE courses ADD COLUMN series_order INTEGER NOT NULL DEFAULT 0;
