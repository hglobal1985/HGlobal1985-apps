-- 使用統計加「使用模式」（業主 2026-11-26）：mode＝elder（至尊模式）／super（超派模式）／空字串（這項功能上線前的舊資料，沒記模式）。
CREATE TABLE usage_stats_new (
  day TEXT NOT NULL,
  hour INTEGER NOT NULL,
  device TEXT NOT NULL,
  os TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  admin INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hour, device, os, kind, target, admin, mode)
);
INSERT INTO usage_stats_new (day, hour, device, os, kind, target, admin, mode, n) SELECT day, hour, device, os, kind, target, admin, '', n FROM usage_stats;
DROP TABLE usage_stats;
ALTER TABLE usage_stats_new RENAME TO usage_stats;
