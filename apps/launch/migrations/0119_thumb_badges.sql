-- 縮圖符號（業主 2026-11-23）：系列卡、課程卡、中心卡各自指定的小縮圖符號（emoji 或短文字）、文字色與底色。
-- kind：course（key＝課程編號）、series（key＝系列名稱）、center（key＝centerKey，小寫的中心名稱）。
CREATE TABLE thumb_badges (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  symbol TEXT NOT NULL,
  fg TEXT NOT NULL,
  bg TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (kind, key)
);
