-- 各教育中心的地址（顯示在該中心還沒有課程時的提示文字；只存行動大學，與中央的中心清單無關）。
CREATE TABLE center_info (
  center_key TEXT PRIMARY KEY,
  center_label TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
