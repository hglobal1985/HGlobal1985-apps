-- 瀏覽次數改成「每進入一次頁面就 +1」（業主 2026-11-16：不再區分是否同一人、同一天）。
-- 一張計數表：kind＝center／series，key＝中心代碼或系列名稱，total＝累計次數。舊的 center_views／series_views 保留不刪，只用來帶入目前的累計數。
CREATE TABLE page_views (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, key)
);
INSERT INTO page_views (kind, key, total) SELECT 'center', center_key, COUNT(*) FROM center_views GROUP BY center_key;
INSERT INTO page_views (kind, key, total) SELECT 'series', series, COUNT(*) FROM series_views GROUP BY series;
