-- 封面輪播與相簿（業主 2026-11-21）：中心、系列、課程的封面可放最多 100 張照片或 1 分鐘內的短影音；中心頁的「相簿」與封面輪播是同一份資料。
CREATE TABLE cover_media (
  id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('center', 'series', 'course')),
  center_key TEXT,            -- owner_kind = 'center' 時的中心鑰匙（中央改名時由 center-reconcile 一起換）
  owner_key TEXT NOT NULL DEFAULT '',  -- series＝系列名稱、course＝課程編號；center 固定空字串
  kind TEXT NOT NULL DEFAULT 'image' CHECK (kind IN ('image', 'video')),
  r2_key TEXT NOT NULL,
  poster_key TEXT,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX cover_media_center ON cover_media (center_key, position);
CREATE INDEX cover_media_owner ON cover_media (owner_kind, owner_key, position);
-- 中心原本上傳的首頁圖變成相簿第一張（尺寸未知，當橫式）。
INSERT INTO cover_media (id, owner_kind, center_key, owner_key, kind, r2_key, position, created_by)
SELECT lower(hex(randomblob(8))), 'center', center_key, '', 'image', COALESCE(cover_key, edm_key), 0, 'migration'
FROM center_art WHERE COALESCE(cover_key, edm_key) IS NOT NULL;
