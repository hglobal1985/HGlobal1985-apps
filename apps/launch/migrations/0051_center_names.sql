-- 教育中心的自訂顯示名稱：只是行動大學要顯示的名字（不改中央的中心清單與中心代碼）；沒設定時預設「去掉數字代碼＋教育中心」。
CREATE TABLE center_names (
  center_key TEXT PRIMARY KEY,
  center_label TEXT NOT NULL,
  display_name TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
