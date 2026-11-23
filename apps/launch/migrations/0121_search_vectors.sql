-- 語意搜尋（業主 2026-11-23）：課程名稱與章節標題的向量（BGE-M3，正規化後量化成 int8，再轉 base64 文字存放）。
-- txt＝產生向量時的原文字，標題改了就會重新產生。只有「公開的標題文字」，沒有任何會員或 Amway 資料。
CREATE TABLE search_vectors (
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  txt TEXT NOT NULL,
  vec TEXT NOT NULL,
  PRIMARY KEY (kind, ref_id)
);
