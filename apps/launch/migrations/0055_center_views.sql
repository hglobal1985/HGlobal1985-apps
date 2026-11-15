-- 中心專屬頁瀏覽計數：同一位會員同一天同一中心只算一次。
CREATE TABLE center_views (
  center_key TEXT NOT NULL,
  member_sub TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (center_key, member_sub, day)
);
