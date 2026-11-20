import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error 部署腳本是純 JavaScript
import { subsetFont, usedIconNames } from "../scripts/subset-icons.mjs";

const base = new URL("../../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/", import.meta.url);
const map: Record<string, number> = JSON.parse(readFileSync(new URL("glyphmaps/Ionicons.json", base), "utf8"));
const font = readFileSync(new URL("Fonts/Ionicons.ttf", base));

test("圖示字型瘦身：保留用到的圖示、字型變小、表格校驗正確", () => {
  const r = subsetFont(font, [map["play"], map["share-outline"]]);
  assert.ok(r.font.length < font.length / 3);
  // 整個字型的校驗和必須是 0xB1B0AFBA（head.checkSumAdjustment 正確）
  let sum = 0;
  const b = Buffer.concat([r.font, Buffer.alloc((4 - (r.font.length % 4)) % 4)]);
  for (let i = 0; i < b.length; i += 4) sum = (sum + b.readUInt32BE(i)) >>> 0;
  assert.equal(sum, 0xb1b0afba);
});

test("圖示字型瘦身：掃描 App 原始碼找到用到的圖示（含實心／外框兩版）", () => {
  const used: Set<string> = usedIconNames([new URL("../../mobile/src", import.meta.url).pathname, new URL("../../mobile/app", import.meta.url).pathname], map);
  for (const n of ["play", "chevron-back", "share-outline", "share-social-outline", "close"]) assert.ok(used.has(n), n);
  assert.ok(!used.has("logo-tiktok"));
});

test("圖示字型瘦身：字碼不在字型裡就丟出錯誤（部署時改用完整字型）", () => {
  assert.throws(() => subsetFont(font, [0x41]));
});
