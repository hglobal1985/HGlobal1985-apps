-- 中心每月課表圖（業主 2026-11-21 方案 A）：每個中心每個月一張圖（ym＝YYYY-MM），同月重傳就是更換。
CREATE TABLE center_schedules (
  center_key TEXT NOT NULL,
  ym TEXT NOT NULL CHECK (ym GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  center_label TEXT NOT NULL DEFAULT '',
  image_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  edited_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (center_key, ym)
);
