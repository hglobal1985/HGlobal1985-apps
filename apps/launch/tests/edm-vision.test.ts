import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVision } from "../src/edm-vision.ts";

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
