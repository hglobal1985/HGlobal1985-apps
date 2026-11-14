-- 封面裁切框（占 EDM 圖片寬高的比例 JSON：{"x","y","w"}，高由 16:9 算出）。
-- 規則：課程介紹頁的「預設停留位置」＝封面框的上緣（edm_view_y 由它算出），兩者永遠同步；NULL＝未知（舊資料或手動指定位置）。
ALTER TABLE courses ADD COLUMN cover_rect TEXT;
