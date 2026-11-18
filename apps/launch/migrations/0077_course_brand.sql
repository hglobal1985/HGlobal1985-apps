-- 品牌獨立成欄位（業主 2026-11-18）：品牌與分類拆開，課程／素材各自選一個品牌（brand_logos.id）。
-- 沒有手動上傳封面時，用該品牌的 logo 當封面（取代「使用品牌 logo 作為封面」勾選）。
ALTER TABLE courses ADD COLUMN brand_id TEXT;
-- 既有資料：分類對得到品牌（舊的「品牌 logo 對應分類」設定）的課程與素材，自動填入品牌（原分類不動，業主之後在後台確認再清）。
UPDATE courses SET brand_id = (
  SELECT b.id FROM brand_logos b
  WHERE b.logo_key IS NOT NULL
    AND EXISTS (SELECT 1 FROM json_each(b.categories) je WHERE instr('、' || courses.category || '、', '、' || je.value || '、') > 0)
  ORDER BY b.sort_order LIMIT 1
);
