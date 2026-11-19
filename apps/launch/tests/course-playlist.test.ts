import assert from "node:assert/strict";
import { test } from "node:test";
import { textCoverLines } from "../src/contract.ts";
import { guessCenter, processImportJobs } from "../src/imports.ts";
import { createTestDb } from "./sqlite-d1.ts";

const CENTERS = ["自強中心 061", "圓滿屏東中心 221", "新竹中心 122", "仁愛屏東中心 310"];

test("依影片標題判讀主辦中心：完整名稱優先、尾兩字唯一才採用、沒寫或歧義就留空", () => {
  assert.equal(guessCenter("銅章會議 自強中心 2026/11", CENTERS), "自強中心 061");
  assert.equal(guessCenter("2026年10月銅章會議 圓滿屏東", CENTERS), "圓滿屏東中心 221");
  assert.equal(guessCenter("銅章會議 新竹", CENTERS), "新竹中心 122"); // 完整名稱「新竹」
  assert.equal(guessCenter("銅章會議 屏東場", CENTERS), ""); // 「屏東」同時符合兩個中心＝歧義
  assert.equal(guessCenter("銅章會議 圓滿屏東場", CENTERS), "圓滿屏東中心 221");
  assert.equal(guessCenter("銅章會議 2026年12月", CENTERS), "");
});

test("固定格式文字封面：名稱換行成『銅章會議』與『X年X月』", () => {
  assert.deepEqual(textCoverLines("銅章會議2026年10月"), ["銅章會議", "2026年10月"]);
  assert.deepEqual(textCoverLines("銅章會議"), ["銅章會議"]);
  assert.equal(textCoverLines("寰宇銅章會議"), null);
});

test("播放清單匯入成課程：照示範課程設定、日期取上傳日、重複影片不再建立、先建草稿", async () => {
  const db = createTestDb();
  await db.prepare("INSERT INTO central_snapshots (key, value) VALUES ('centers', ?)").bind(JSON.stringify(CENTERS)).run();
  await db.prepare("INSERT INTO review_groups (id, name) VALUES ('g1', '群組')").run().catch(() => undefined);
  await db.prepare("INSERT INTO courses (id, title, category, price_twd, min_rank_code, status, series, host_unit, host_center_key, event_start, allow_president, location_none, show_full, view_scope) VALUES ('tpl', '銅章會議2026年10月', '培訓、事業', 50, 'r15', 'published', '銅章會議', '圓滿屏東中心 221', '圓滿屏東中心 221', '2026-10-13', 1, 1, 1, 'all')").run();
  await db.prepare("INSERT INTO lessons (id, course_id, position, title, media_type, media_ref, kind) VALUES ('tpl-1', 'tpl', 1, '銅章會議2026年10月', 'youtube', 'vidOld', 'chapter')").run();
  await db.prepare("INSERT INTO import_jobs (id, course_id, block_id, kind, url) VALUES ('j1', 'tpl', 'course:tpl', 'playlist', 'PLX')").run();
  const real = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ items: [
      { snippet: { title: "銅章會議 自強中心" }, contentDetails: { videoId: "vidA", videoPublishedAt: "2026-11-12T03:00:00Z" } },
      { snippet: { title: "銅章會議" }, contentDetails: { videoId: "vidB", videoPublishedAt: "2026-08-14T16:30:00Z" } },
      { snippet: { title: "舊的" }, contentDetails: { videoId: "vidOld", videoPublishedAt: "2026-10-14T03:00:00Z" } },
    ] }), { status: 200 })) as typeof fetch;
  try {
    await processImportJobs({ DB: db, YOUTUBE_API_KEY: "k" } as never);
  } finally {
    globalThis.fetch = real;
  }
  const job = await db.prepare("SELECT status, imported FROM import_jobs WHERE id = 'j1'").first<{ status: string; imported: number }>();
  assert.deepEqual([job?.status, job?.imported], ["done", 2]);
  const { results } = await db.prepare("SELECT c.title, c.status, c.host_unit, c.event_start, c.price_twd, c.min_rank_code, c.series, c.category, c.view_scope, l.media_ref FROM courses c JOIN lessons l ON l.course_id = c.id WHERE c.series = '銅章會議' AND c.id <> 'tpl' ORDER BY c.event_start").all<Record<string, unknown>>();
  assert.equal(results.length, 2);
  // 影片上傳時間 2026-08-14T16:30Z ＝ 台灣 8/15
  assert.deepEqual({ ...results[0] }, { title: "銅章會議2026年8月", status: "draft", host_unit: "", event_start: "2026-08-15", price_twd: 50, min_rank_code: "r15", series: "銅章會議", category: "培訓、事業", view_scope: "all", media_ref: "vidB" });
  assert.equal(results[1]!.host_unit, "自強中心 061");
  assert.equal(results[1]!.title, "銅章會議2026年11月");
});
