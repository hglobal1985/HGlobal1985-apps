import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSharerRank } from "../src/central.ts";

test("清單分享者的獎銜與獎章：直接用中央回傳的 rank_label 與 rank_badge", () => {
  const full = parseSharerRank({ rank_label: "金章", rank_badge: { badge_url: "https://id.hglobal1985.com/badges/r10.png?v=1", badge: { width: 380, height: 720, art_top: 100, art_bottom: 600 } } });
  assert.deepEqual(full, { rankLabel: "金章", rankBadge: "https://id.hglobal1985.com/badges/r10.png?v=1", rankBadgeArt: { width: 380, height: 720, top: 100, bottom: 600 } });
  // 該獎銜沒有圖：只有名稱
  assert.deepEqual(parseSharerRank({ rank_label: "安麗寶寶", rank_badge: null }), { rankLabel: "安麗寶寶", rankBadge: null, rankBadgeArt: null });
  // 會員沒開 Amway 或獎銜未審核：全是 null → 不顯示
  assert.equal(parseSharerRank({ rank_label: null, rank_badge: null }), null);
  assert.equal(parseSharerRank({}), null);
  // 圖片網址不是 https 或圖案範圍不完整：不顯示圖，仍顯示名稱
  assert.equal(parseSharerRank({ rank_label: "金章", rank_badge: { badge_url: "http://x/y.png", badge: { width: 380, height: 720, art_top: 1, art_bottom: 2 } } })?.rankBadge, null);
  assert.equal(parseSharerRank({ rank_label: "金章", rank_badge: { badge_url: "https://x/y.png", badge: { width: 380 } } })?.rankBadge, null);
  // 也容忍放在 fields 裡
  assert.equal(parseSharerRank({ fields: { rank_label: "銀章" } })?.rankLabel, "銀章");
});
