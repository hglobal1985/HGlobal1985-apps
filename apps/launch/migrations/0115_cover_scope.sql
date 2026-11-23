-- 封面輪播照片與中心「EDM」分頁的照片分開存放（業主 2026-11-23）：
-- scope＝cover（封面編輯上傳的封面輪播照片）／edm（中心頁 EDM 分頁、新增教材 › 上傳照片影音）。
-- 兩邊的儲存空間、排序、張數上限（各 100）完全獨立；既有的中心照片原本就是「相簿」，一律歸 edm（封面預設仍會輪播它們，不會消失）；系列、課程只有封面輪播，歸 cover。
ALTER TABLE cover_media ADD COLUMN scope TEXT NOT NULL DEFAULT 'cover' CHECK (scope IN ('cover', 'edm'));
UPDATE cover_media SET scope = 'edm' WHERE owner_kind = 'center';
CREATE INDEX cover_media_scope ON cover_media (owner_kind, owner_key, center_key, scope, position);
-- 中心封面「是否輪播 EDM」：沒有資料列＝預設打勾（顯示）。
CREATE TABLE center_cover_cfg (
  center_key TEXT PRIMARY KEY,
  show_edm INTEGER NOT NULL DEFAULT 1
);
