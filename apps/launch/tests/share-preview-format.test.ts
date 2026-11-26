import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveShareMeta, titleOf } from "../src/og.ts";
import { DEFAULT_SHARE_SETTINGS } from "../src/contract.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("分享預覽一律格式：第一行「名稱 | 寰宇行動大學 🎓」，第二行是學習金句；兩個字的卡片名稱（amway/dd）也找得到", async () => {
  const db = createTestDb();
  assert.equal(titleOf(DEFAULT_SHARE_SETTINGS, "白金會"), "白金會 | 寰宇行動大學 🎓");
  await db.prepare("INSERT INTO courses (id, title, status, series, mat_url, is_list) VALUES ('c1', '安麗與白金線上溝通會', 'published', '白金會', 'dd', 1)").run();
  await db.prepare("INSERT INTO short_links (slug, kind, value) VALUES ('amway', 'series', '白金會')").run();
  await db.prepare("INSERT INTO quotes (body) VALUES ('每天進步一點點')").run().catch(() => undefined);
  const m = await resolveShareMeta(db, new URL("https://learn.test/amway/dd"));
  assert.ok(m, "兩個字的卡片名稱也要有預覽");
  assert.equal(m!.title, "安麗與白金線上溝通會 | 寰宇行動大學 🎓");
  assert.equal(m!.url, "https://learn.test/amway/dd");
  assert.ok(m!.description.length > 0 && !m!.description.includes("📍"), "第二行只有金句（沒有地址）");
  const byId = await resolveShareMeta(db, new URL("https://learn.test/course/c1"));
  assert.equal(byId?.title, "安麗與白金線上溝通會 | 寰宇行動大學 🎓", "單堂課程的預覽用課程名稱");
  await db.prepare("INSERT INTO short_links (slug, kind, value) VALUES ('wh', 'series', '白金會2')").run().catch(() => undefined);
  const series = await resolveShareMeta(db, new URL("https://learn.test/series/" + encodeURIComponent("白金會")));
  assert.equal(series?.title, "白金會 | 寰宇行動大學 🎓");
});
