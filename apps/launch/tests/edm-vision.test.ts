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

test("inferDate 沒寫年份一律用上傳年份（不管星期、不管最近年份）", () => {
  const up = new Date("2026-11-10T04:00:00Z");
  assert.equal(inferDate("11/24日（二）晚上7:30", up), "2026-11-24");
  assert.equal(inferDate("12月5日（六）", up), "2026-12-05");
  assert.equal(inferDate("1/8 講座", up), "2026-01-08");
  assert.equal(inferDate("1/8 講座", new Date("2025-12-31T20:00:00Z")), "2026-01-08", "台灣時間已是 2026");
});
test("inferDate 海報有寫完整年份就照海報；沒有日期回 null", () => {
  const up = new Date("2026-11-10T04:00:00Z");
  assert.equal(inferDate("日期: 2027 / 1 / 8 講座", up), "2027-01-08");
  assert.equal(inferDate("2027年1月8日 講座", up), "2027-01-08");
  assert.equal(inferDate("沒有日期", up), null);
});

