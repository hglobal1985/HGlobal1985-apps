-- 中心 EDM 的裁切：16:9 封面（中心卡縮圖）與預設停留位置（＝封面框上緣），做法與課程相同。
ALTER TABLE center_art ADD COLUMN cover_key TEXT;
ALTER TABLE center_art ADD COLUMN cover_rect TEXT;
ALTER TABLE center_art ADD COLUMN edm_view_y REAL NOT NULL DEFAULT 0;
