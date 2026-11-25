-- 相簿權限與瀏覽數（業主 2026-11-25）：
-- album_permissions：超級管理員在相簿的「齒輪」設定「誰可以上傳」。key＝資料夾編號（center:中心:edm、series:系列、course:課程、block:區塊）或類別（group:edm／cover／series／course／block／treasure）；
-- upload_min_rank＝獎銜代碼，該獎銜（含）以上的會員可以上傳到這個資料夾；空字串＝只有原本的管理權限。資料夾自己的設定優先於類別。
CREATE TABLE IF NOT EXISTS album_permissions (
  key TEXT PRIMARY KEY,
  upload_min_rank TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- 成交百寶箱預設開放給白金以上上傳。
INSERT OR IGNORE INTO album_permissions (key, upload_min_rank) VALUES ('group:treasure', 'platinum');
-- 每張照片的瀏覽數（在看圖畫面看過一次算一次，同一次開啟網站不重複算）。
ALTER TABLE cover_media ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
