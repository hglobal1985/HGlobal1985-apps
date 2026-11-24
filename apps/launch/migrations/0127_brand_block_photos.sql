-- 品牌館的品牌卡全部開放「區塊新增照片」（業主 2026-11-24：任意區塊都能新增照片，相簿分頁彙整）。
UPDATE courses SET block_photos = 1 WHERE zone = 'amway_brand' OR id = 'cqqxw4z2';
