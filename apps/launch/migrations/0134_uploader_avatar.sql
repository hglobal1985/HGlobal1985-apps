-- 相簿照片上傳者的頭像（業主 2026-11-25）：單張看圖時，「第幾張，共幾張」同一列最左邊顯示上傳者的頭像與暱稱。
-- 頭像是會員中心的公開資料（不是 Amway 資料），上傳當下跟暱稱（uploader_name）一起記下；舊照片沒有就只顯示暱稱或不顯示。
ALTER TABLE cover_media ADD COLUMN uploader_avatar TEXT NOT NULL DEFAULT '';
