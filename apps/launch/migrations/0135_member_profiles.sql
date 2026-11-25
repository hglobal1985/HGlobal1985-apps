-- 會員的最新暱稱與頭像（業主 2026-11-25）：相簿照片的「上傳者」標記要永遠是使用者最新修改的版本，
-- 所以每次會員登入使用時，把會員中心的公開暱稱與頭像更新到這裡（只有變動才寫入）；顯示上傳者時以這裡為準，沒有才用上傳當下記下的 uploader_name／uploader_avatar。
-- 暱稱、頭像是會員中心的公開資料，不是 Amway 資料。
CREATE TABLE IF NOT EXISTS member_profiles (
  sub TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- 先用既有照片上傳當下記下的暱稱與頭像墊底（之後會員一使用就會更新成最新）。
INSERT OR IGNORE INTO member_profiles (sub, name, avatar)
SELECT created_by, MAX(uploader_name), MAX(uploader_avatar) FROM cover_media
WHERE created_by NOT IN ('', 'migration', 'course-edit') AND uploader_name <> '' GROUP BY created_by;
