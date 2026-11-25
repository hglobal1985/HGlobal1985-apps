import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSynonymText } from "../src/synonyms.ts";

test("自訂關聯詞：一行一組、用 = 隔開、至少兩個詞、去重", () => {
  assert.deepEqual(parseSynonymText("王老師 = 王儷凱\n水課程＝益之源=淨水器\n單獨一個\n\n a = a "), [["王老師", "王儷凱"], ["水課程", "益之源", "淨水器"]]);
});
