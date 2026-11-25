import assert from "node:assert/strict";
import test from "node:test";
import { defaultSearchSettings, normalizeSearchSettings } from "../src/search-settings.ts";

test("搜尋參數：亂填退回預設、數字夾在範圍內並對齊級距", () => {
  const d = defaultSearchSettings();
  assert.equal(d.semanticMin, 0.62);
  const n = normalizeSearchSettings({ semanticMin: 5, semanticLimit: 12.4, semanticEnabled: "x", fuzzyMaxDiff: -3, bogus: 1 });
  assert.equal(n.semanticMin, 0.9);
  assert.equal(n.semanticLimit, 12);
  assert.equal(n.semanticEnabled, true);
  assert.equal(n.fuzzyMaxDiff, 0);
  assert.equal("bogus" in n, false);
});
