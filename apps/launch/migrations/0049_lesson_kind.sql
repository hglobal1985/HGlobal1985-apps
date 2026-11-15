-- 章節（chapter）與「其他教材」（material）：教材與章節同款操作，但不計入章節堂數、學習進度與成就。
ALTER TABLE lessons ADD COLUMN kind TEXT NOT NULL DEFAULT 'chapter';
