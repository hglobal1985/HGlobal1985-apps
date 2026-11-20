-- 指定邀請制的課程不可能「完全公開」：先前勾選前就是公開的課程，訪客仍能看到內容（業主 2026-11-20 回報）。
UPDATE courses SET is_public = 0 WHERE invite_only = 1 AND is_public = 1;
