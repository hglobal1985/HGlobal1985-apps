-- 使用統計（業主 2026-11-22，管理員 > 設定 > 使用統計）：匿名彙總，不存會員編號、不存 IP。
-- day＝台灣日期、hour＝台灣小時（0～23）；device＝mobile／tablet／desktop；os＝ios／android／other；
-- kind＝visit（開啟網站／App）、card_course／card_series／card_center（首頁卡片被點開）；target＝卡片識別（課程編號、系列名稱、中心名稱），visit 為空字串。
CREATE TABLE usage_stats (
  day TEXT NOT NULL,
  hour INTEGER NOT NULL,
  device TEXT NOT NULL,
  os TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hour, device, os, kind, target)
);
