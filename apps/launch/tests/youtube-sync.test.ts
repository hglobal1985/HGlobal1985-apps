import assert from "node:assert/strict";
import { test } from "node:test";
import type { Env } from "../src/d1.ts";
import { sortMaterialsByDate, defaultSyncFormat, playlistIdOf, renameYoutubeSync, runYoutubeSync, syncTitle } from "../src/imports.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("同步清單：網址判讀與教材名稱格式", () => {
  assert.equal(playlistIdOf("https://www.youtube.com/playlist?list=PLRuUjdLupIVp8nJWWDkDtE2JH3kYGV7Br"), "PLRuUjdLupIVp8nJWWDkDtE2JH3kYGV7Br");
  assert.equal(playlistIdOf("https://example.com/playlist?list=PLabcdefghijk"), null);
  assert.equal(playlistIdOf("not a url"), null);
  const dflt = defaultSyncFormat("會長翡翠鑽石會議");
  assert.equal(syncTitle(dflt, "2026年11月 會長翡翠鑽石會議 主持：王大明", "2026-11-20"), "2026年11月 會長翡翠鑽石會議（主持王大明）");
  assert.equal(syncTitle(dflt, "會議全程", "2026-10-03"), "2026年10月 會長翡翠鑽石會議");
  assert.equal(syncTitle(defaultSyncFormat("王老師小線對焦會"), "對焦會", null), "王老師小線對焦會");
  // 自訂命名規則（業主 2026-11-20）：「2026年3月x日 王老師小線對焦」
  const wang = "{年}年{月}月{日}日 王老師小線對焦";
  assert.equal(syncTitle(wang, "對焦會", "2026-03-14"), "2026年3月14日 王老師小線對焦");
  assert.equal(syncTitle(wang, "2026年3月 對焦會", "2026-03-09"), "2026年3月9日 王老師小線對焦");
  assert.equal(syncTitle(wang, "2026年3月 對焦會", "2026-04-02"), "2026年3月 王老師小線對焦"); // 影片日期月份對不上標題，日省略
  assert.equal(syncTitle(wang, "2026年3月18日 對焦會", "2026-04-02"), "2026年3月18日 王老師小線對焦");
});

test("同步清單：同名的教材才加（月/日），不同名的不加", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, YOUTUBE_API_KEY: "k" };
  await db.prepare("INSERT INTO courses (id, title, status) VALUES ('c1', '對焦會', 'published')").run();
  await db.prepare("INSERT INTO youtube_syncs (id, url, playlist_id, course_id, title_prefix) VALUES ('s1', 'u', 'PLX', 'c1', '王老師小線對焦會')").run();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL | Request) => {
    if (String(u).includes("playlistItems"))
      return new Response(JSON.stringify({ items: [
        { snippet: { title: "a" }, contentDetails: { videoId: "AAAAAAAAAAA", videoPublishedAt: "2025-12-15T01:00:00Z" } },
        { snippet: { title: "b" }, contentDetails: { videoId: "BBBBBBBBBBB", videoPublishedAt: "2025-12-08T01:00:00Z" } },
        { snippet: { title: "c" }, contentDetails: { videoId: "CCCCCCCCCCC", videoPublishedAt: "2026-01-05T01:00:00Z" } },
      ] }), { status: 200 });
    return new Response("x", { status: 404 });
  }) as typeof fetch;
  try {
    await runYoutubeSync(env, "s1");
  } finally {
    globalThis.fetch = realFetch;
  }
  const rows = (await db.prepare("SELECT title FROM lessons WHERE course_id = 'c1' ORDER BY position").all<{ title: string }>()).results;
  assert.deepEqual(rows.map((r) => r.title), ["2026年1月 王老師小線對焦會", "2025年12月 王老師小線對焦會（12/15）", "2025年12月 王老師小線對焦會（12/8）"]);
});

test("同步清單：只加新影片、最新的在最上面、再按一次不重複", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, YOUTUBE_API_KEY: "k" };
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await run("INSERT INTO courses (id, title, status) VALUES ('c1', '會長翡翠鑽石會議', 'published')");
  await run("INSERT INTO youtube_syncs (id, url, playlist_id, course_id, title_prefix) VALUES ('s1', 'u', 'PLX', 'c1', '會長翡翠鑽石會議')");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL | Request) => {
    if (String(u).includes("playlistItems"))
      return new Response(JSON.stringify({ items: [
        { snippet: { title: "11月 主持：陳小美" }, contentDetails: { videoId: "BBBBBBBBBBB", videoPublishedAt: "2026-11-05T01:00:00Z" } },
        { snippet: { title: "10月會議" }, contentDetails: { videoId: "AAAAAAAAAAA", videoPublishedAt: "2026-10-05T01:00:00Z" } },
      ] }), { status: 200 });
    return new Response("x", { status: 404 });
  }) as typeof fetch;
  try {
    assert.equal((await runYoutubeSync(env, "s1")).imported, 2);
    assert.equal((await runYoutubeSync(env, "s1")).imported, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
  const rows = (await db.prepare("SELECT title, media_ref, kind FROM lessons WHERE course_id = 'c1' ORDER BY position").all<{ title: string; media_ref: string; kind: string }>()).results;
  assert.deepEqual(rows.map((r) => r.title), ["2026年11月 會長翡翠鑽石會議（主持陳小美）", "2026年10月 會長翡翠鑽石會議"]);
  assert.ok(rows.every((r) => r.kind === "material"));
  const st = await db.prepare("SELECT last_imported, last_note FROM youtube_syncs WHERE id = 's1'").first<{ last_imported: number; last_note: string }>();
  assert.equal(st?.last_imported, 0);
  assert.match(st!.last_note, /沒有新的影片/);
});

test("同步清單：依命名規則重新命名已匯入的教材", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, YOUTUBE_API_KEY: "k" };
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await run("INSERT INTO courses (id, title, status) VALUES ('c1', '對焦會', 'published')");
  await run("INSERT INTO youtube_syncs (id, url, playlist_id, course_id, title_prefix, title_format) VALUES ('s1', 'u', 'PLX', 'c1', '王老師小線對焦會', '{年}年{月}月{日}日 王老師小線對焦')");
  await run("INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type, media_ref, kind) VALUES ('l1', 'c1', 1, '2026年3月 王老師小線對焦會', 0, 'youtube', 'AAAAAAAAAAA', 'material')");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL | Request) => {
    if (String(u).includes("playlistItems"))
      return new Response(JSON.stringify({ items: [{ snippet: { title: "a" }, contentDetails: { videoId: "AAAAAAAAAAA", videoPublishedAt: "2026-03-14T01:00:00Z" } }] }), { status: 200 });
    return new Response("x", { status: 404 });
  }) as typeof fetch;
  try {
    assert.equal((await renameYoutubeSync(env, "s1")).renamed, 1);
    assert.equal((await renameYoutubeSync(env, "s1")).renamed, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
  const t = await db.prepare("SELECT title FROM lessons WHERE id = 'l1'").first<{ title: string }>();
  assert.equal(t?.title, "2026年3月14日 王老師小線對焦");
});

test("同步來的教材卡：整張卡依日期新到舊，舊影片不會被放到最下面；有區塊的卡不動", async () => {
  const db = createTestDb();
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await run("INSERT INTO courses (id, title, status) VALUES ('c1', 'A', 'published'), ('c2', 'B', 'published')");
  const add = (c: string, id: string, pos: number, date: string | null, kind = "material", full = 0) =>
    run("INSERT INTO lessons (id, course_id, position, title, duration_minutes, kind, event_date, is_full) VALUES (?, ?, ?, ?, 0, ?, ?, ?)", id, c, pos, id, kind, date, full);
  // 新匯入的在上、原本舊的被放到最後（真實發生的情況）
  await add("c1", "n1", 1, "2026-03-16");
  await add("c1", "n2", 2, "2025-09-22");
  await add("c1", "o1", 3, "2026-03-09");
  await add("c1", "o2", 4, "2025-07-15");
  await add("c1", "nd", 5, null);
  await add("c1", "full", 6, null, "material", 1);
  assert.ok((await sortMaterialsByDate(db, "c1")) > 0);
  const rows = (await db.prepare("SELECT id FROM lessons WHERE course_id = 'c1' ORDER BY position").all<{ id: string }>()).results;
  assert.deepEqual(rows.map((r) => r.id), ["n1", "o1", "n2", "o2", "nd", "full"]);
  assert.equal(await sortMaterialsByDate(db, "c1"), 0); // 已經排好就不動
  await add("c2", "s", 1, null, "section");
  await add("c2", "x", 2, "2020-01-01");
  await add("c2", "y", 3, "2026-01-01");
  assert.equal(await sortMaterialsByDate(db, "c2"), 0); // 有區塊＝手動編排
});
