-- 雲端資料夾同步：白金溝通會的命名規則加上檔名括號裡的文字（杜杜龍 2026-11-26）。
UPDATE drive_syncs SET title_format = '簡報{年}年{月}月 白金溝通會{括號}' WHERE title_format = '簡報{年}年{月}月 白金溝通會';
