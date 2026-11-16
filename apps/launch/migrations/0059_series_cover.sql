-- 系列頁比照中心頁：系列 EDM 也有 16:9 封面（裁切框＋預設停留位置）與瀏覽人次。
ALTER TABLE series_art ADD COLUMN cover_key TEXT;
ALTER TABLE series_art ADD COLUMN cover_rect TEXT;
ALTER TABLE series_art ADD COLUMN edm_view_y REAL NOT NULL DEFAULT 0;
CREATE TABLE series_views (
  series TEXT NOT NULL,
  member_sub TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (series, member_sub, day)
);
