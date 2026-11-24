import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FIELDS, OTHER, buildPrompt, cleanOcrText, fmtOf, normalizeFields, parseStructured } from "../src/edm-structure.ts";

test("cleanOcrText 去掉 Markdown 符號並還原換行", () => {
  assert.equal(cleanOcrText("### 圖片上的文字\\n* **8月25日（日）**：活動\\n* **產品嘉年華**"), "8月25日（日）：活動\n產品嘉年華");
});

test("parseStructured 依欄位順序整理，其他內容獨立", () => {
  const r = parseStructured('好的 {"日期":"2026/8/25（日）","時間":["現場 13:30","線上 14:00"],"主題":"翻轉未來","其他內容":"Zoom 555 666 1959"}', DEFAULT_FIELDS);
  assert.ok(r);
  assert.equal(r.f.length, DEFAULT_FIELDS.length);
  assert.deepEqual(r.f[0], ["日期", "2026/8/25（日）"]);
  assert.deepEqual(r.f[1], ["時間", "現場 13:30\n線上 14:00"]);
  assert.deepEqual(r.f[4], ["講師", ""]);
  assert.equal(r.o, "Zoom 555 666 1959");
  assert.equal(parseStructured("壞掉了", DEFAULT_FIELDS), null);
});

test("normalizeFields 去重、不可和其他內容同名、格式版本會隨內容變", () => {
  const f = normalizeFields([{ name: "日期" }, { name: " 日期 " }, { name: OTHER }, { name: "地點", hint: "x" }]);
  assert.deepEqual(f.map((x) => x.name), ["日期", "地點"]);
  assert.notEqual(fmtOf(f), fmtOf(DEFAULT_FIELDS));
  assert.equal(normalizeFields(null).length, DEFAULT_FIELDS.length);
});

test("buildPrompt 含所有欄位與其他內容", () => {
  const p = buildPrompt("海報文字", DEFAULT_FIELDS, "2026-11-24");
  assert.ok(p.user.includes("講師資歷") && p.user.includes(OTHER) && p.user.includes("海報文字"));
});

test("cleanOcrText 去掉 AI 的開場白與猜測（業主 2026-11-24 回報）", () => {
  const raw = '"天下第一餐"是一個健康飲食活動，圖片上有以下文字： 天下第一餐\\n宋莉鈴老師\\n超過三十年健康管理經驗 今天是 2026-11-23，活動舉辦日期應該是 2026-11-23。';
  const c = cleanOcrText(raw);
  assert.ok(!/今天是|應該|圖片上有/.test(c), c);
  assert.ok(c.includes("宋莉鈴老師") && c.includes("超過三十年健康管理經驗"));
});
