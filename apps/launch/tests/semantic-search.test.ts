import assert from "node:assert/strict";
import { test } from "node:test";
import { cosine, packVec, unpackVec } from "../src/semantic-search.ts";

test("語意搜尋：向量量化打包後相似度仍正確", () => {
  const a = Array.from({ length: 64 }, (_, i) => Math.sin(i));
  const b = a.map((x) => x + 0.01);
  const c = a.map((x) => -x);
  const [va, vb, vc] = [a, b, c].map((v) => unpackVec(packVec(v)));
  assert.ok(cosine(va!, va!) > 0.97);
  assert.ok(cosine(va!, vb!) > 0.95);
  assert.ok(cosine(va!, vc!) < -0.9);
  assert.equal(va!.length, 64);
});
