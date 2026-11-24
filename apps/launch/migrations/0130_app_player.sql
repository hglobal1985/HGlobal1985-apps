-- 使用行動大學播放器（業主 2026-11-24）：
-- ① 同步 YouTube 清單新增選項：1＝匯入的影片用行動大學播放器（預設），0＝存成外部連結、點了開新網頁到 YouTube。
ALTER TABLE youtube_syncs ADD COLUMN use_app_player INTEGER NOT NULL DEFAULT 1;

-- ② U40創業學院所有教材一律改成行動大學播放器：把「外部連結（YouTube 網址）」改存成影片來源，並刪掉連結，
--    學員端不再拿到 YouTube 網址（沒有權限的人拿不到影片編號，有權限的人只在播放時才取得）。
UPDATE lessons
   SET media_type = 'youtube',
       media_ref = (SELECT CASE WHEN a.link_url LIKE 'https://www.youtube.com/watch?v=%' THEN substr(a.link_url, 33, 11) ELSE substr(a.link_url, 30, 11) END
                      FROM lesson_attachments a WHERE a.lesson_id = lessons.id AND a.kind = 'link' AND a.att_type = 'youtube' LIMIT 1),
       yt_checked_at = NULL
 WHERE kind = 'material' AND is_full = 0 AND media_type = 'demo'
   AND course_id IN (SELECT id FROM courses WHERE series = 'U40創業學院')
   AND EXISTS (SELECT 1 FROM lesson_attachments a WHERE a.lesson_id = lessons.id AND a.kind = 'link' AND a.att_type = 'youtube'
               AND (a.link_url LIKE 'https://www.youtube.com/watch?v=___________%' OR a.link_url LIKE 'https://www.youtube.com/live/___________%'));

DELETE FROM lesson_attachments
 WHERE kind = 'link' AND att_type = 'youtube'
   AND lesson_id IN (SELECT id FROM lessons WHERE media_type = 'youtube' AND course_id IN (SELECT id FROM courses WHERE series = 'U40創業學院'));
