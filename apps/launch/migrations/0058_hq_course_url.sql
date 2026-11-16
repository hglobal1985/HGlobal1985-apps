-- 總部（沒有主辦中心）課程的專屬網址 /hq/英譯姓名-001：host_center_key 是 NULL 時，原本的唯一索引不會擋重複，另外補一個。
CREATE UNIQUE INDEX courses_url_name_hq ON courses(url_name) WHERE url_name IS NOT NULL AND host_center_key IS NULL;
