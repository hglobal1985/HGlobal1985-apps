-- 誰可以瀏覽（業主 2026-11-17）：all 所有人含訪客／members 所有會員／hglobal 寰宇夥伴／center 中心會員；hide_guests＝所有人但不對訪客列出。
ALTER TABLE courses ADD COLUMN view_scope TEXT NOT NULL DEFAULT 'all';
ALTER TABLE courses ADD COLUMN hide_guests INTEGER NOT NULL DEFAULT 0;
UPDATE courses SET view_scope = 'members' WHERE is_list = 0 AND is_public = 0;
