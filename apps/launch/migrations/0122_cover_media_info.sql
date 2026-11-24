-- EDM 圖片資訊面板（業主 2026-11-24）：記上傳者姓名、上傳時的原始檔資訊與 EXIF（網頁上傳時由瀏覽器讀出，壓縮後的圖片不含 EXIF）。
ALTER TABLE cover_media ADD COLUMN uploader_name TEXT NOT NULL DEFAULT '';
ALTER TABLE cover_media ADD COLUMN meta TEXT NOT NULL DEFAULT '';
