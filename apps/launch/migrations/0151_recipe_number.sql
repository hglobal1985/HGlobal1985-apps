-- 食譜短網址的流水號（杜杜龍 2026-11-26）：網址＝/icook/001（前綴在「設定 › 分享預設值」可改）。送出（草稿 → 待審核／已發佈）時才領號，編輯中的草稿與被刪除的不佔號碼。
ALTER TABLE recipes ADD COLUMN number INTEGER;
UPDATE recipes SET number = (SELECT COUNT(*) FROM recipes r2 WHERE r2.status <> 'draft' AND (r2.created_at < recipes.created_at OR (r2.created_at = recipes.created_at AND r2.id <= recipes.id))) WHERE status <> 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS recipes_number ON recipes (number) WHERE number IS NOT NULL;
