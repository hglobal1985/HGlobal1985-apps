-- 食譜上傳者所屬中心（杜杜龍 2026-11-26）：新增食譜時自動抓上傳者目前所屬的中心（取自會員中心，畫面上不可手動改）；
-- 超級管理員更換上傳者時，改成新上傳者的中心。中心改名由 center-reconcile 一起換（KEY_COLS／LABEL_COLS）。
ALTER TABLE recipes ADD COLUMN author_center_key TEXT NOT NULL DEFAULT '';
ALTER TABLE recipes ADD COLUMN author_center_label TEXT NOT NULL DEFAULT '';
