// 圖示字型瘦身（2026-11-21）：Ionicons 字型有 1,300 多個圖示（約 390KB），網站只用到幾十個。
// 部署打包時（embed-static.mjs）掃描 App 原始碼裡出現的圖示名稱，只保留那些圖示的外形，其餘圖示清成空白；
// 圖示編號、字碼完全不變，所以畫面寫法不用改。任何一步出錯就回傳原本的完整字型（網站不會壞）。
// 不需要任何額外套件：只改 glyf／loca／post 三張表。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** App 原始碼裡所有引號內的字串，對得上圖示名稱的就算用到（圖示名稱有型別檢查，一定是寫死的字串）。 */
export function usedIconNames(srcDirs, glyphMap) {
  const used = new Set();
  const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  for (const dir of srcDirs) {
    for (const file of walk(dir)) {
      if (!/\.(tsx?|jsx?)$/.test(file)) continue;
      for (const m of readFileSync(file, "utf8").matchAll(/["'`]([a-z0-9]+(?:-[a-z0-9]+)*)["'`]/g)) if (m[1] in glyphMap) used.add(m[1]);
    }
  }
  // 保險：同一個圖示的實心、外框兩種版本一起保留（多幾 KB，避免切換狀態時用到另一種卻漏掉）。
  for (const name of [...used]) {
    const base = name.replace(/-(outline|sharp)$/, "");
    for (const v of [base, `${base}-outline`]) if (v in glyphMap) used.add(v);
  }
  return used;
}

const tag = (b, o) => b.toString("latin1", o, o + 4);

function tables(b) {
  const n = b.readUInt16BE(4);
  const out = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + 16 * i;
    out[tag(b, o)] = { offset: b.readUInt32BE(o + 8), length: b.readUInt32BE(o + 12) };
  }
  return out;
}

/** cmap（format 4 或 12）：字碼 → 圖示編號。 */
function cmapLookup(b, cmap) {
  const map = new Map();
  const n = b.readUInt16BE(cmap.offset + 2);
  for (let i = 0; i < n; i++) {
    const sub = cmap.offset + b.readUInt32BE(cmap.offset + 4 + 8 * i + 4);
    const format = b.readUInt16BE(sub);
    if (format === 4) {
      const segX2 = b.readUInt16BE(sub + 6);
      const ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = b.readUInt16BE(ends + 2 * s), start = b.readUInt16BE(starts + 2 * s);
        const delta = b.readInt16BE(deltas + 2 * s), ro = b.readUInt16BE(ranges + 2 * s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g;
          if (ro === 0) g = (c + delta) & 0xffff;
          else {
            g = b.readUInt16BE(ranges + 2 * s + ro + 2 * (c - start));
            if (g) g = (g + delta) & 0xffff;
          }
          if (g && !map.has(c)) map.set(c, g);
        }
      }
    } else if (format === 12) {
      const groups = b.readUInt32BE(sub + 12);
      for (let gI = 0; gI < groups; gI++) {
        const o = sub + 16 + 12 * gI;
        const start = b.readUInt32BE(o), end = b.readUInt32BE(o + 4), g0 = b.readUInt32BE(o + 8);
        for (let c = start; c <= end; c++) if (!map.has(c)) map.set(c, g0 + (c - start));
      }
    }
  }
  return map;
}

const checksum = (buf) => {
  let sum = 0;
  const padded = Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4)]);
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
};

/** 回傳瘦身後的字型；codepoints＝要保留的字碼。 */
export function subsetFont(font, codepoints) {
  const t = tables(font);
  for (const need of ["head", "maxp", "loca", "glyf", "cmap"]) if (!t[need]) throw Error(`missing ${need}`);
  const numGlyphs = font.readUInt16BE(t.maxp.offset + 4);
  const longLoca = font.readInt16BE(t.head.offset + 50) === 1;
  const loca = (i) => (longLoca ? font.readUInt32BE(t.loca.offset + 4 * i) : font.readUInt16BE(t.loca.offset + 2 * i) * 2);
  const glyphAt = (g) => font.subarray(t.glyf.offset + loca(g), t.glyf.offset + loca(g + 1));

  const cmap = cmapLookup(font, t.cmap);
  const keep = new Set([0]);
  for (const cp of codepoints) {
    const g = cmap.get(cp);
    if (g === undefined) throw Error(`codepoint ${cp} not in font`);
    keep.add(g);
  }
  // 組合圖示（composite）用到的零件也要保留。
  const queue = [...keep];
  while (queue.length) {
    const data = glyphAt(queue.pop());
    if (data.length < 10 || data.readInt16BE(0) >= 0) continue;
    let o = 10;
    for (;;) {
      const flags = data.readUInt16BE(o), comp = data.readUInt16BE(o + 2);
      if (!keep.has(comp)) { keep.add(comp); queue.push(comp); }
      o += 4 + (flags & 1 ? 4 : 2);
      if (flags & 8) o += 2; else if (flags & 0x40) o += 4; else if (flags & 0x80) o += 8;
      if (!(flags & 0x20)) break;
    }
  }

  const parts = [];
  const newLoca = Buffer.alloc(4 * (numGlyphs + 1));
  let at = 0;
  for (let g = 0; g < numGlyphs; g++) {
    newLoca.writeUInt32BE(at, 4 * g);
    if (keep.has(g)) {
      const data = glyphAt(g);
      const pad = Buffer.alloc((4 - (data.length % 4)) % 4);
      parts.push(data, pad);
      at += data.length + pad.length;
    }
  }
  newLoca.writeUInt32BE(at, 4 * numGlyphs);
  const replaced = { glyf: Buffer.concat(parts), loca: newLoca };
  if (t.post) {
    // post 改成 format 3（不存圖示名稱，網頁字型不需要）。
    const post = Buffer.from(font.subarray(t.post.offset, t.post.offset + 32));
    post.writeUInt32BE(0x00030000, 0);
    replaced.post = post;
  }
  const head = Buffer.from(font.subarray(t.head.offset, t.head.offset + t.head.length));
  head.writeInt16BE(1, 50); // loca 一律用長格式
  head.writeUInt32BE(0, 8); // checkSumAdjustment 先清零，最後重算
  replaced.head = head;
  delete t.FFTM; // FontForge 的時間戳記，用不到

  const names = Object.keys(t).sort();
  const n = names.length;
  const headerLen = 12 + 16 * n;
  const datas = names.map((name) => replaced[name] ?? font.subarray(t[name].offset, t[name].offset + t[name].length));
  const header = Buffer.alloc(headerLen);
  font.copy(header, 0, 0, 4); // sfnt 版本
  let p2 = 1, e = 0;
  while (p2 * 2 <= n) { p2 *= 2; e++; }
  header.writeUInt16BE(n, 4);
  header.writeUInt16BE(p2 * 16, 6);
  header.writeUInt16BE(e, 8);
  header.writeUInt16BE(n * 16 - p2 * 16, 10);
  const body = [];
  let offset = headerLen;
  names.forEach((name, i) => {
    const data = datas[i];
    const o = 12 + 16 * i;
    header.write(name, o, 4, "latin1");
    header.writeUInt32BE(checksum(data), o + 4);
    header.writeUInt32BE(offset, o + 8);
    header.writeUInt32BE(data.length, o + 12);
    const pad = Buffer.alloc((4 - (data.length % 4)) % 4);
    body.push(data, pad);
    offset += data.length + pad.length;
  });
  const out = Buffer.concat([header, ...body]);
  const headAt = out.readUInt32BE(12 + 16 * names.indexOf("head") + 8);
  out.writeUInt32BE((0xb1b0afba - checksum(out)) >>> 0, headAt + 8);
  return { font: out, kept: keep.size, total: numGlyphs };
}
