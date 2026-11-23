import assert from "node:assert/strict";
import { test } from "node:test";
import { imageSize } from "../src/image-size.ts";

test("imageSize：PNG、JPEG、WebP（VP8X／VP8L／VP8）讀寬高；讀不出來回 null", () => {
  const png = new Uint8Array(33);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x04, 0xb0, 0, 0, 0x02, 0x58]);
  assert.deepEqual(imageSize(png), { width: 1200, height: 600 });
  // JPEG：SOI + APP0(長度 4) + SOF0（高 900、寬 600）
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x84, 0x02, 0x58, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(imageSize(jpg), { width: 600, height: 900 });
  const riff = (kind: string, body: number[]) => {
    const a = new Uint8Array(40);
    a.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, ...[...kind].map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
    a.set(body, 20);
    return a;
  };
  // VP8X：寬 1000（999）高 500（499）從位移 24 起
  const x = riff("VP8X", []);
  x.set([0xe7, 0x03, 0x00, 0xf3, 0x01, 0x00], 24);
  assert.deepEqual(imageSize(x), { width: 1000, height: 500 });
  // VP8L：位移 21 起 14 位寬、14 位高（各減 1）
  const l = riff("VP8L", []);
  const w = 800 - 1;
  const h = 400 - 1;
  const bits = (w | (h << 14)) >>> 0;
  l.set([0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff], 20);
  assert.deepEqual(imageSize(l), { width: 800, height: 400 });
  // VP8：位移 26／28 起各 14 位
  const v = riff("VP8 ", []);
  v.set([0x58, 0x02, 0x84, 0x03], 26);
  assert.deepEqual(imageSize(v), { width: 600, height: 900 });
  assert.equal(imageSize(new Uint8Array([1, 2, 3, 4, 5])), null);
});
