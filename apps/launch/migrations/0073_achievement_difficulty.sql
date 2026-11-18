-- 徽章任務難易度（業主 2026-11-18）：1＝簡單、2＝普通、3＝困難；後台可逐一調整。這裡先依條件類型與數量給初始值。
ALTER TABLE achievements ADD COLUMN difficulty INTEGER NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 3);
UPDATE achievements SET difficulty = CASE condition_type
  WHEN 'feature_used' THEN 1
  WHEN 'lessons_completed' THEN CASE WHEN threshold <= 5 THEN 1 WHEN threshold <= 20 THEN 2 ELSE 3 END
  WHEN 'courses_completed' THEN CASE WHEN threshold <= 1 THEN 1 WHEN threshold <= 3 THEN 2 ELSE 3 END
  WHEN 'lessons_in_a_day' THEN CASE WHEN threshold <= 2 THEN 1 WHEN threshold <= 3 THEN 2 ELSE 3 END
  WHEN 'watch_minutes' THEN CASE WHEN threshold <= 60 THEN 1 WHEN threshold <= 120 THEN 2 ELSE 3 END
  WHEN 'learning_days' THEN CASE WHEN threshold <= 3 THEN 1 WHEN threshold <= 10 THEN 2 ELSE 3 END
  WHEN 'streak_days' THEN CASE WHEN threshold <= 3 THEN 1 WHEN threshold <= 5 THEN 2 ELSE 3 END
  WHEN 'early_lessons' THEN CASE WHEN threshold <= 1 THEN 1 WHEN threshold <= 5 THEN 2 ELSE 3 END
  WHEN 'night_lessons' THEN CASE WHEN threshold <= 1 THEN 1 WHEN threshold <= 5 THEN 2 ELSE 3 END
  WHEN 'weekend_lessons' THEN CASE WHEN threshold <= 1 THEN 1 WHEN threshold <= 5 THEN 2 ELSE 3 END
  WHEN 'courses_enrolled' THEN CASE WHEN threshold <= 2 THEN 1 WHEN threshold <= 5 THEN 2 ELSE 3 END
  WHEN 'categories_explored' THEN CASE WHEN threshold <= 2 THEN 1 WHEN threshold <= 5 THEN 2 ELSE 3 END
  WHEN 'comments_posted' THEN CASE WHEN threshold <= 1 THEN 1 WHEN threshold <= 5 THEN 2 ELSE 3 END
  WHEN 'centers_subscribed' THEN CASE WHEN threshold <= 1 THEN 1 WHEN threshold <= 3 THEN 2 ELSE 3 END
  WHEN 'series_subscribed' THEN CASE WHEN threshold <= 1 THEN 1 WHEN threshold <= 3 THEN 2 ELSE 3 END
  WHEN 'subscriptions_total' THEN CASE WHEN threshold <= 3 THEN 1 WHEN threshold <= 6 THEN 2 ELSE 3 END
  ELSE 2 END;
