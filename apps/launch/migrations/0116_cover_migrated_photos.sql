-- 中心頁「EDM」分頁只顯示業主自己上傳的 EDM（業主 2026-11-23）：
-- migration 0102 把各中心原本的「中心封面圖」搬成相簿第一張（created_by = 'migration'），0115 又把中心的照片一律歸 edm；
-- 這些原本的中心封面圖是封面，不是 EDM，改歸「封面輪播照片」（cover），EDM 分頁就不再看到它們。
UPDATE cover_media SET scope = 'cover' WHERE owner_kind = 'center' AND created_by = 'migration';
