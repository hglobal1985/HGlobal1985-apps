import assert from "node:assert/strict";
import { test } from "node:test";
import type { Env, ImagesBinding } from "../src/d1.ts";
import { shrinkImage } from "../src/image-store.ts";
import { createTestDb } from "./sqlite-d1.ts";

const fake = (w: number, h: number, outBytes: number): ImagesBinding => ({
  info: async () => ({ width: w, height: h }),
  input: () => ({ transform: () => ({ output: async () => ({ response: () => new Response(new Uint8Array(outBytes)) }) }) }),
});
const big = new Uint8Array(5000).buffer;

test("圖片存進 R2 前壓縮：太大的縮小後取代原圖、長邊在上限內的只照畫質重新壓縮、PNG 小檔不動、失敗與不支援格式照原樣", async () => {
  const env = (img?: ImagesBinding): Env => ({ DB: createTestDb(), IMAGES: img });
  const shrunk = await shrinkImage(env(fake(4000, 3000, 800)), big, "image/jpeg", "general");
  assert.equal(shrunk.size, 800);
  const within = await shrinkImage(env(fake(900, 600, 800)), big, "image/jpeg", "general");
  assert.equal(within.size, 800); // 長邊在上限內也照畫質重新壓縮（尺寸不變）
  const smallPng = await shrinkImage(env(fake(900, 600, 800)), big, "image/png", "general");
  assert.equal(smallPng.size, 5000);
  const noBinding = await shrinkImage(env(), big, "image/jpeg", "general");
  assert.equal(noBinding.size, 5000);
  const gif = await shrinkImage(env(fake(4000, 3000, 800)), big, "image/gif", "general");
  assert.equal(gif.size, 5000);
  const bigger = await shrinkImage(env(fake(4000, 3000, 9000)), big, "image/jpeg", "edm");
  assert.equal(bigger.size, 5000);
  const broken: ImagesBinding = { info: async () => { throw new Error("x"); }, input: () => { throw new Error("x"); } };
  assert.equal((await shrinkImage(env(broken), big, "image/png", "center")).size, 5000);
});
