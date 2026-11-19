-- 審核者「修改後通過」（業主 2026-11-20）：to_text 是申請的內容，final_text 是審核者核准的內容（沒修改就是空）。
ALTER TABLE review_log ADD COLUMN final_text TEXT NOT NULL DEFAULT '';
