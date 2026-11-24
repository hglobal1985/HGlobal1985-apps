-- Cloudflare 即時縮圖用量（業主 2026-11-24）：每個月、每張圖、每種寬度只記一次（＝Cloudflare 算的「不重複縮圖」）。
-- cls＝優先等級：cover（封面：課程、系列、中心照片）> edm（中心 EDM）> album（其他相簿，例如成交百寶箱）；grp＝細項（中心鑰匙、區塊編號…）。
CREATE TABLE thumb_usage (
  month TEXT NOT NULL,
  key TEXT NOT NULL,
  w INTEGER NOT NULL,
  cls TEXT NOT NULL,
  grp TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (month, key, w)
);
CREATE INDEX thumb_usage_cls ON thumb_usage (month, cls, grp);
