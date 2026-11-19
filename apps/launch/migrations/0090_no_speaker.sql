-- 課程卡「主講人、獎銜、職稱」勾選「無」（業主 2026-11-19）：勾了就沒有這三個欄位，課程專屬網址改用課程名稱的英譯＋編號。
ALTER TABLE courses ADD COLUMN no_speaker INTEGER NOT NULL DEFAULT 0 CHECK (no_speaker IN (0, 1));
