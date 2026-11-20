-- 同步 YouTube 清單的「命名規則」（業主 2026-11-20）：每份同步各自存一條規則，可用 {年}{月}{日}{主持}{標題} 代入。
ALTER TABLE youtube_syncs ADD COLUMN title_format TEXT NOT NULL DEFAULT '';
-- 已設定的清單先補上目前使用的規則（與之前的命名結果一致）。
UPDATE youtube_syncs SET title_format = '{年}年{月}月 ' || title_prefix || '（主持{主持}）';
-- 王老師小線對焦會：改成「2026年3月14日 王老師小線對焦」。
UPDATE youtube_syncs SET title_format = '{年}年{月}月{日}日 王老師小線對焦' WHERE id = 'yswang001';
