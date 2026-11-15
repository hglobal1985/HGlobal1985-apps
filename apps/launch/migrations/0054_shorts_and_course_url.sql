-- 短影音專輯：勾了的課程，其章節與其他教材（影音）在「單元」頁歸類為短影音。
ALTER TABLE courses ADD COLUMN is_shorts INTEGER NOT NULL DEFAULT 0;

-- 課程專屬網址：learn.hglobal1985.com/中心縮寫/{url_name}（例如 wang-xiaoming-001）；一旦產生就固定。
ALTER TABLE courses ADD COLUMN url_name TEXT;
CREATE UNIQUE INDEX courses_url_name ON courses(host_center_key, url_name) WHERE url_name IS NOT NULL;
