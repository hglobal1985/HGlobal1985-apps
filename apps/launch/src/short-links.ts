/** 縮寫規則：英文字母（大小寫都可以，網址照設定的大小寫顯示，輸入時不分大小寫）、數字、連字號，2～30 字，不能以連字號開頭或結尾。 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])$/i;

/** 總部（沒有主辦中心）課程的專屬網址前綴：/hq/英譯姓名-001。「hq」是保留縮寫，中心不能用。 */
export const HQ_SLUG = "hq";

/** 網站本身的頁面路徑，不能拿來當縮寫（否則短網址會蓋掉正常頁面）。 */
export const RESERVED_SLUGS = new Set([
  "courses", "course", "learn", "learning", "notices", "me", "admin", "orders", "settings", "achievements", "auth",
  "privacy", "support", "api", "assets", "static", "login", "logout", "home", "index", "app", "www", "c", "s", "hq", "library", "library-invite",
]);
