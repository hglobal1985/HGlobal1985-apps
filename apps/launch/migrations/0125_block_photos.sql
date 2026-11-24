-- 區塊可新增照片（業主 2026-11-24）：課程勾選後，編輯模式的每個區塊多一個「新增照片」，與中心 EDM 共用上傳元件；先只開放「實戰百寶箱」。
ALTER TABLE courses ADD COLUMN block_photos INTEGER NOT NULL DEFAULT 0;
UPDATE courses SET block_photos = 1 WHERE id = 'cqqxw4z2' OR title = '實戰百寶箱';
