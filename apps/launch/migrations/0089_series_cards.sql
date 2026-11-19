-- 系列卡改版（業主 2026-11-19）：
-- ① 系列有自己的設定：顯示標題（只改顯示，系列識別名稱 courses.series 不動）、是否顯示在「所有系列」。封面（直式＋橫式）沿用 series_art。
-- ② 系列頁裡可以單獨隱藏某張卡（只是不在這個系列頁顯示，仍可用網址、搜尋、單元找到）。
-- ③ 沒有系列的「課程卡」一律放進「未分類」系列（只有超級管理員看得到）；清單卡沒有系列照舊直接在第一層。
CREATE TABLE series_settings (
  series TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  show_in_all INTEGER NOT NULL DEFAULT 1 CHECK (show_in_all IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
ALTER TABLE courses ADD COLUMN series_hidden INTEGER NOT NULL DEFAULT 0 CHECK (series_hidden IN (0, 1));
UPDATE courses SET series = '未分類' WHERE series = '' AND is_list = 0;
