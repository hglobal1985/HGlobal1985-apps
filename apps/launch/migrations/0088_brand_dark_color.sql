-- 品牌 Logo 的深色模式底色（業主 2026-11-18）：使用者切換成深色模式時，所有品牌 logo 出現的地方改用這個底色（沒設定＝照原本的底色或底圖）。
ALTER TABLE brand_logos ADD COLUMN bg_color_dark TEXT;
