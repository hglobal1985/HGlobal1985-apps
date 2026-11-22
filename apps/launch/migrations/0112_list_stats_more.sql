-- 清單成效再加三項（業主 2026-11-22）：每個項目被點開的次數、分享與複製次數。只統計 migration 之後的新資料。
CREATE TABLE my_list_item_hits (
  list_id TEXT NOT NULL REFERENCES my_lists(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (list_id, item_id)
);
-- kind：share（主人按分享或複製連結）／copy（別人把這份清單複製成自己的）。
CREATE TABLE my_list_events (
  list_id TEXT NOT NULL REFERENCES my_lists(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (list_id, kind)
);
