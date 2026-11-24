-- 相簿照片的場景辨識（業主 2026-11-24）：Workers AI 看照片，認出行為、場景、物品，存成逗號分隔的短標籤，用於搜尋（分類標籤＝「場景」）。
-- scene_status：''＝待辨識、'working'＝處理中（超過 10 分鐘會重來）、'done'＝完成、'failed'＝失敗（不再自動重試）。
ALTER TABLE cover_media ADD COLUMN scene_status TEXT NOT NULL DEFAULT '';
ALTER TABLE cover_media ADD COLUMN scene_text TEXT NOT NULL DEFAULT '';
ALTER TABLE cover_media ADD COLUMN scene_model TEXT NOT NULL DEFAULT '';
ALTER TABLE cover_media ADD COLUMN scene_at TEXT;
CREATE INDEX cover_media_scene_pending ON cover_media (owner_kind, scene_status);
