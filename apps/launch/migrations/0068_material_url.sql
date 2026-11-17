-- 素材的第二層短網址（業主 2026-11-17）：learn.hglobal1985.com/系列短網址/素材名稱。
-- mat_url＝素材（清單類別的課程）自己取的英文名稱，同一個系列內不可重複；只有超級管理員能設定。
ALTER TABLE courses ADD COLUMN mat_url TEXT;
CREATE UNIQUE INDEX courses_series_mat_url ON courses(series, mat_url) WHERE mat_url IS NOT NULL;
-- 改名前的舊網址永遠有效。
CREATE TABLE material_url_aliases (
  series TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  course_id TEXT NOT NULL,
  PRIMARY KEY (series, name)
);
