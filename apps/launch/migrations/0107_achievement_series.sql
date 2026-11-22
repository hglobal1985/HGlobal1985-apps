-- 成就「指定學習」（業主 2026-11-22）：指定系列卡（學完系列內幾門課）時，把系列名稱存在這個欄位。
ALTER TABLE achievements ADD COLUMN series TEXT;
