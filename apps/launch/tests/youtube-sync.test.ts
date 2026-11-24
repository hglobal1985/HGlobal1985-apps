import assert from "node:assert/strict";
import { test } from "node:test";
import type { Env } from "../src/d1.ts";
import { sortMaterialsByDate, defaultSyncFormat, playlistIdOf, renameYoutubeSync, runYoutubeSync, syncTitle } from "../src/imports.ts";
import { handleApi } from "../src/api.ts";
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

test("命名規則已含 {日} 時，同名也不再加（月/日）尾巴", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, YOUTUBE_API_KEY: "k" };
  await db.prepare("INSERT INTO courses (id, title, status) VALUES ('c1', '對焦會', 'published')").run();
  await db.prepare("INSERT INTO youtube_syncs (id, url, playlist_id, course_id, title_prefix, title_format) VALUES ('s1', 'u', 'PLX', 'c1', '王老師小線對焦會', '{年}年{月}月{日}日 王老師小線對焦')").run();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL | Request) => {
    if (String(u).includes("playlistItems"))
      return new Response(JSON.stringify({ items: [
        { snippet: { title: "a" }, contentDetails: { videoId: "AAAAAAAAAAA", videoPublishedAt: "2026-05-04T01:00:00Z" } },
        { snippet: { title: "b" }, contentDetails: { videoId: "BBBBBBBBBBB", videoPublishedAt: "2026-05-04T05:00:00Z" } },
      ] }), { status: 200 });
    return new Response("x", { status: 404 });
  }) as typeof fetch;
  try {
    await runYoutubeSync(env, "s1");
  } finally {
    globalThis.fetch = realFetch;
  }
  const rows = (await db.prepare("SELECT title FROM lessons WHERE course_id = 'c1'").all<{ title: string }>()).results;
  assert.deepEqual(rows.map((r) => r.title), ["2026年5月4日 王老師小線對焦", "2026年5月4日 王老師小線對焦"]);
});

test("同步排序規則：放最後面、手動鎖定後不重排（業主 2026-11-20）", async () => {
  const run = async (mode: string, locked: number) => {
    const db = createTestDb();
    const env: Env = { DB: db, YOUTUBE_API_KEY: "k" };
    const q = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
    await q("INSERT INTO courses (id, title, status) VALUES ('c1', 'A', 'published')");
    await q("INSERT INTO youtube_syncs (id, url, playlist_id, course_id, title_prefix, title_format, sort_mode, sort_locked) VALUES ('s1', 'u', 'PLX', 'c1', 'A', '{年}年{月}月{日}日 A', ?, ?)", mode, locked);
    // 手動排好的舊順序：2020 在最上面、2026 在後面
    await q("INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type, media_ref, kind, event_date) VALUES ('old1', 'c1', 1, 'old1', 0, 'youtube', 'OLD11111111', 'material', '2020-01-01'), ('old2', 'c1', 2, 'old2', 0, 'youtube', 'OLD22222222', 'material', '2026-01-01')");
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string | URL | Request) =>
      String(u).includes("playlistItems")
        ? new Response(JSON.stringify({ items: [{ snippet: { title: "n" }, contentDetails: { videoId: "NEW11111111", videoPublishedAt: "2025-05-05T01:00:00Z" } }] }), { status: 200 })
        : new Response("x", { status: 404 })) as typeof fetch;
    try {
      await runYoutubeSync(env, "s1");
    } finally {
      globalThis.fetch = real;
    }
    return (await db.prepare("SELECT id FROM lessons WHERE course_id = 'c1' ORDER BY position").all<{ id: string }>()).results.map((r) => (r.id.startsWith("old") ? r.id : "new"));
  };
  assert.deepEqual(await run("date_desc", 0), ["old2", "new", "old1"]); // 自動：整張依日期重排
  assert.deepEqual(await run("date_desc", 1), ["new", "old1", "old2"]); // 已鎖定：手動順序不動，新影片依日期插入（2025 比 old1 的 2020 新，插在它前面）
  assert.deepEqual(await run("top", 0), ["new", "old1", "old2"]); // 放最上面，其餘不動
  assert.deepEqual(await run("bottom", 0), ["old1", "old2", "new"]); // 放最後面，其餘不動
  assert.deepEqual(await run("bottom", 1), ["old1", "old2", "new"]); // 使用者明確選「放最後面」就照選的放，不重排
});

test("手動調整教材順序後，這張卡的同步自動鎖定", async () => {
  const db = createTestDb();
  const env = { DB: db, DEMO_LOGIN: "on" } as never;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as Record<string, unknown> };
  };
  const token = ((await call("POST", "/auth/demo", { sub: "demo-admin" })).data as { token: string }).token;
  const course = await call("POST", "/admin/courses", { title: "卡" }, token);
  const cid = course.data.id as string;
  const q = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await q("INSERT INTO lessons (id, course_id, position, title, duration_minutes, kind, event_date) VALUES ('m1', ?, 101, 'm1', 0, 'material', '2026-01-01'), ('m2', ?, 102, 'm2', 0, 'material', '2026-02-01')", cid, cid);
  await q("INSERT INTO youtube_syncs (id, url, playlist_id, course_id, title_prefix) VALUES ('s1', 'u', 'PLX', ?, 'x')", cid);
  assert.equal((await db.prepare("SELECT sort_locked FROM youtube_syncs WHERE id = 's1'").first<{ sort_locked: number }>())?.sort_locked, 0);
  assert.equal((await call("POST", `/admin/courses/${cid}/lessons/order?lite=1`, { ids: ["m2", "m1"] }, token)).status, 200);
  assert.equal((await db.prepare("SELECT sort_locked FROM youtube_syncs WHERE id = 's1'").first<{ sort_locked: number }>())?.sort_locked, 1);
  // 設定頁可解除鎖定
  assert.equal((await call("PATCH", "/admin/youtube-syncs/s1", { unlock: true, sortMode: "top" }, token)).status, 200);
  const st = await db.prepare("SELECT sort_locked, sort_mode FROM youtube_syncs WHERE id = 's1'").first<{ sort_locked: number; sort_mode: string }>();
  assert.equal(st?.sort_locked, 0);
  assert.equal(st?.sort_mode, "top");
});

test("已手動排序（鎖定）的卡：新影片依日期插入正確位置，其餘順序完全不動（業主 2026-11-20）", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, YOUTUBE_API_KEY: "k" };
  const q = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await q("INSERT INTO courses (id, title, status) VALUES ('c1', 'A', 'published')");
  await q("INSERT INTO youtube_syncs (id, url, playlist_id, course_id, title_prefix, title_format, sort_mode, sort_locked) VALUES ('s1', 'u', 'PLX', 'c1', 'A', '{年}年{月}月{日}日 A', 'date_desc', 1)");
  // 使用者手動排好的順序（不是依日期）：2026、2020、2024
  await q("INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type, media_ref, kind, event_date) VALUES ('a', 'c1', 1, 'a', 0, 'youtube', 'AAA11111111', 'material', '2026-01-01'), ('b', 'c1', 2, 'b', 0, 'youtube', 'BBB11111111', 'material', '2020-01-01'), ('c', 'c1', 3, 'c', 0, 'youtube', 'CCC11111111', 'material', '2024-01-01')");
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL | Request) =>
    String(u).includes("playlistItems")
      ? new Response(JSON.stringify({ items: [
          { snippet: { title: "n1" }, contentDetails: { videoId: "N1111111111", videoPublishedAt: "2027-06-01T01:00:00Z" } }, // 最新：放最上面
          { snippet: { title: "n2" }, contentDetails: { videoId: "N2222222222", videoPublishedAt: "2022-06-01T01:00:00Z" } }, // 比 2020 新：插在 2020 前面
          { snippet: { title: "n3" }, contentDetails: { videoId: "N3333333333", videoPublishedAt: "2019-06-01T01:00:00Z" } }, // 最舊：放最後
        ] }), { status: 200 })
      : new Response("x", { status: 404 })) as typeof fetch;
  try {
    await runYoutubeSync(env, "s1");
  } finally {
    globalThis.fetch = real;
  }
  const order = (await db.prepare("SELECT id, title FROM lessons WHERE course_id = 'c1' ORDER BY position").all<{ id: string; title: string }>()).results.map((r) => (["a", "b", "c"].includes(r.id) ? r.id : r.title.slice(0, 4) + "新"));
  // 手動順序 a(2026)、b(2020)、c(2024) 原樣保留；n1(2027) 在最上面；n2(2022) 插在第一個比它舊的 b(2020) 前面；n3(2019) 放教材最後
  assert.deepEqual(order, ["2027新", "a", "2022新", "b", "c", "2019新"]);
});

test("命名規則：{標題}＝影片原標題；移除文字從最後的名稱拿掉；預覽與匯入共用同一套命名", async () => {
  const { syncTitle, syncNamesFor, parseStrip } = await import("../src/imports.ts");
  assert.equal(syncTitle("{標題}", "【直播】王老師小線對焦 完整版", "2026-03-14"), "【直播】王老師小線對焦 完整版");
  assert.deepEqual(parseStrip("【直播】, 完整版\n 、"), ["【直播】", "完整版"]);
  assert.equal(syncTitle("{標題}", "【直播】王老師小線對焦 完整版", "2026-03-14", parseStrip("【直播】, 完整版")), "王老師小線對焦");
  const names = syncNamesFor([{ title: "A 影片", date: "2026-03-14" }, { title: "A 影片", date: "2026-03-20" }], "{標題}", [], new Set());
  assert.deepEqual(names, ["A 影片（3/14）", "A 影片（3/20）"]);
});

test("同步清單：沒勾「使用行動大學播放器」＝存成外部連結、再同步不重複（業主 2026-11-24）", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, YOUTUBE_API_KEY: "k" };
  await db.prepare("INSERT INTO courses (id, title, status) VALUES ('c1', '外連', 'published')").run();
  await db.prepare("INSERT INTO youtube_syncs (id, url, playlist_id, course_id, title_prefix, use_app_player) VALUES ('s1', 'u', 'PLX', 'c1', '外連', 0)").run();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL | Request) => {
    if (String(u).includes("playlistItems"))
      return new Response(JSON.stringify({ items: [{ snippet: { title: "a" }, contentDetails: { videoId: "AAAAAAAAAAA", videoPublishedAt: "2026-10-05T01:00:00Z" } }] }), { status: 200 });
    return new Response("x", { status: 404 });
  }) as typeof fetch;
  try {
    assert.equal((await runYoutubeSync(env, "s1")).imported, 1);
    assert.equal((await runYoutubeSync(env, "s1")).imported, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
  const l = await db.prepare("SELECT media_type, media_ref FROM lessons WHERE course_id = 'c1'").first<{ media_type: string; media_ref: string | null }>();
  assert.equal(l?.media_type, "demo");
  assert.equal(l?.media_ref, null);
  const a = await db.prepare("SELECT link_url, att_type FROM lesson_attachments WHERE course_id = 'c1'").first<{ link_url: string; att_type: string }>();
  assert.equal(a?.link_url, "https://www.youtube.com/watch?v=AAAAAAAAAAA");
  assert.equal(a?.att_type, "youtube");
});

test("migration 0130：U40創業學院的 YouTube 外部連結教材改存成影片來源並刪掉連結", async () => {
  const { readFileSync } = await import("node:fs");
  const db = createTestDb();
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await run("INSERT INTO courses (id, title, status, series) VALUES ('u1', '系統複製', 'published', 'U40創業學院'), ('o1', '別的', 'published', '其他')");
  const mk = async (id: string, course: string, url: string) => {
    await run("INSERT INTO lessons (id, course_id, position, title, media_type, kind) VALUES (?, ?, ?, 'x', 'demo', 'material')", id, course, Math.floor(Math.random() * 1e6));
    await run("INSERT INTO lesson_attachments (id, lesson_id, course_id, name, kind, link_url, att_type, created_by) VALUES (?, ?, ?, 'x', 'link', ?, 'youtube', 'system')", `a-${id}`, id, course, url);
  };
  await mk("m1", "u1", "https://www.youtube.com/watch?v=AAAAAAAAAAA");
  await mk("m2", "u1", "https://www.youtube.com/live/BBBBBBBBBBB?si=zzz");
  await mk("m3", "o1", "https://www.youtube.com/watch?v=CCCCCCCCCCC");
  const sql = readFileSync(new URL("../migrations/0130_app_player.sql", import.meta.url), "utf8").split(/;\s*\n/).map((x) => x.replace(/--.*$/gm, "").trim()).filter((x) => x && !x.startsWith("ALTER"));
  for (const st of sql) await db.prepare(st).run();
  const rows = (await db.prepare("SELECT id, media_type, media_ref FROM lessons WHERE id IN ('m1', 'm2', 'm3') ORDER BY id").all<{ id: string; media_type: string; media_ref: string | null }>()).results.map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ id: "m1", media_type: "youtube", media_ref: "AAAAAAAAAAA" }, { id: "m2", media_type: "youtube", media_ref: "BBBBBBBBBBB" }, { id: "m3", media_type: "demo", media_ref: null }]);
  const left = (await db.prepare("SELECT lesson_id FROM lesson_attachments WHERE lesson_id IN ('m1', 'm2', 'm3')").all<{ lesson_id: string }>()).results.map((r) => r.lesson_id);
  assert.deepEqual(left, ["m3"]);
});
