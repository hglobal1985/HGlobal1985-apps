import assert from "node:assert/strict";
import { test } from "node:test";
import type { Env } from "../src/d1.ts";
import { playlistIdOf, runYoutubeSync, syncTitle } from "../src/imports.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("同步清單：網址判讀與教材名稱格式", () => {
  assert.equal(playlistIdOf("https://www.youtube.com/playlist?list=PLRuUjdLupIVp8nJWWDkDtE2JH3kYGV7Br"), "PLRuUjdLupIVp8nJWWDkDtE2JH3kYGV7Br");
  assert.equal(playlistIdOf("https://example.com/playlist?list=PLabcdefghijk"), null);
  assert.equal(playlistIdOf("not a url"), null);
  assert.equal(syncTitle("會長翡翠鑽石會議", "2026年11月 會長翡翠鑽石會議 主持：王大明", "2026-11-20"), "2026年11月 會長翡翠鑽石會議（主持王大明）");
  assert.equal(syncTitle("會長翡翠鑽石會議", "會議全程", "2026-10-03"), "2026年10月 會長翡翠鑽石會議");
  assert.equal(syncTitle("王老師小線對焦會", "對焦會", null), "王老師小線對焦會");
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
