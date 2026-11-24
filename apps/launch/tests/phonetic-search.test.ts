import assert from "node:assert/strict";
import { test } from "node:test";
import { approxSyl, normSyllable, syllables } from "../src/phonetic-search.ts";

test("同音搜尋：一支援＝益之源、翹舌平舌與前後鼻音視為相同", () => {
  assert.deepEqual(syllables("益之源"), syllables("一支援"));
  assert.equal(normSyllable("zhang"), "zan");
  assert.equal(normSyllable("shi"), "si");
  assert.deepEqual(syllables("安麗與白金線上溝通會"), syllables("安麗與白金先上溝通會"));
  assert.ok(approxSyl(syllables("益之源營養課程"), syllables("一支援"), 0));
  assert.ok(!approxSyl(syllables("白金線上溝通會"), syllables("一支援"), 0));
  assert.deepEqual(syllables("Amway 白金"), ["amway", "bai", "jin"]);
});
