-- 公告模組化（業主 2026-11-21）：首頁、系列、中心共用同一張公告表 center_broadcasts（center_key 存範圍鍵：中心鍵／series:系列名／home）。
-- 把原本「設定 > 跑馬燈公告」啟用中的首頁公告搬進來（範圍＝home，維持原本順序：原第 1 則最新）；舊表 announcements 不再使用。
INSERT INTO center_broadcasts (id, center_key, body, edited_by, created_at)
SELECT id, 'home', body, created_by, strftime('%Y-%m-%d %H:%M:%S', 'now', '-' || position || ' seconds')
FROM announcements WHERE enabled = 1;
