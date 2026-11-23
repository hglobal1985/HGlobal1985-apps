import { test } from "node:test";
import assert from "node:assert/strict";
import { inferDate, parseVision } from "../src/edm-vision.ts";

test("parseVision 讀出文字與合法的活動日期", () => {
  const r = parseVision('好的：{"text":"自強中心 12月  講座","event_date":"2026-12-05"}');
  assert.equal(r.text, "自強中心 12月 講座");
  assert.equal(r.date, "2026-12-05");
});
test("parseVision 日期不存在或格式錯誤就當作沒有", () => {
  assert.equal(parseVision('{"text":"a","event_date":"2026-02-31"}').date, null);
  assert.equal(parseVision('{"text":"a","event_date":"12/05"}').date, null);
  assert.equal(parseVision('{"text":"a","event_date":null}').date, null);
});
test("parseVision 不是 JSON 時整段當文字", () => {
  const r = parseVision("只有一段文字");
  assert.equal(r.text, "只有一段文字");
  assert.equal(r.date, null);
});

test("inferDate 有星期就挑星期對得上的年份", () => {
  const now = new Date("2026-11-23T00:00:00Z");
  assert.equal(inferDate('"11/24日（二）晚上7:30" "活動舉辦日期" : 2023-11-24', now), "2026-11-24");
  assert.equal(inferDate("12月5日（六）", now), "2026-12-05");
});
test("inferDate 完整日期優先、沒有星期挑最近年份", () => {
  const now = new Date("2026-11-23T00:00:00Z");
  assert.equal(inferDate("2027年1月8日 講座", now), "2027-01-08");
  assert.equal(inferDate("1/8 講座", now), "2027-01-08");
  assert.equal(inferDate("沒有日期", now), null);
});
