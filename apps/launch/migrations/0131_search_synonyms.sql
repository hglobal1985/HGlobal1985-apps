-- 自訂關聯詞（業主 2026-11-25）：超級管理員在設定頁定義「王老師 = 王儷凱」「水課程 = 益之源 = 淨水器」，
-- 每一列 terms 是同一組關聯詞（JSON 字串陣列）。搜尋時，課程文字裡只要有其中一個詞，其餘的詞也視為該課程的搜尋文字。
CREATE TABLE search_synonyms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terms TEXT NOT NULL
);
