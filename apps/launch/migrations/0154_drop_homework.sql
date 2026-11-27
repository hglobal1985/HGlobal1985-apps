-- 徹底刪除行動大學原本的作業功能（杜杜龍 2026-11-27：作業改由獨立的「寰宇繳作業系統」處理）。
-- 刪除前已確認正式資料庫這六個資料表都是空的（沒有作業、繳交、檔案、留言、分組）。
DROP TABLE IF EXISTS hw_comments;
DROP TABLE IF EXISTS hw_files;
DROP TABLE IF EXISTS hw_submissions;
DROP TABLE IF EXISTS hw_assignments;
DROP TABLE IF EXISTS hw_group_members;
DROP TABLE IF EXISTS hw_groups;
