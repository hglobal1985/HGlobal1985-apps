import assert from "node:assert/strict";
import { test } from "node:test";
import type { Env, R2Bucket } from "../src/d1.ts";
import { processImportJobs } from "../src/imports.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("匯入工作：播放清單、連結、單支影片、封面、照片依序放進指定區塊；已存在的影片不重複", async () => {
  const db = createTestDb();
  const store = new Map<string, Uint8Array>();
  const r2 = { async put(k: string, v: ArrayBuffer) { store.set(k, new Uint8Array(v)); }, async get() { return null; }, async head() { return null; }, async delete() {}, async list() { return { objects: [], truncated: false }; } } as unknown as R2Bucket;
  const env: Env = { DB: db, MEDIA: r2, YOUTUBE_API_KEY: "k" };
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await run("INSERT INTO courses (id, title, is_list, status) VALUES ('c1', '表揚', 1, 'published')");
  const sec = (id: string, pos: number, title: string) => run("INSERT INTO lessons (id, course_id, position, title, kind, media_type) VALUES (?, 'c1', ?, ?, 'section', 'demo')", id, pos, title);
  await sec("b2025", 1, "2025年");
  await run("INSERT INTO lessons (id, course_id, position, title, kind, media_type, media_ref) VALUES ('old', 'c1', 2, '舊的', 'material', 'youtube', 'AAAAAAAAAAA')");
  await sec("b2024", 3, "2024年");
  const job = (id: string, seq: number, block: string, kind: string, url: string, title = "") => run("INSERT INTO import_jobs (id, seq, course_id, block_id, kind, url, title) VALUES (?, ?, 'c1', ?, ?, ?, ?)", id, seq, block, kind, url, title);
  await job("j1", 1, "b2025", "playlist", "PLX");
  await job("j2", 2, "b2025", "link", "https://www.amway.com.tw/iShare/Monthly/Catalog/42102", "2025 表揚專刊");
  await job("j3", 3, "b2024", "cover", "https://sites.google.com/sitesv-images-rt/abc=w1280");
  await job("j4", 4, "b2024", "photo", "https://sites.google.com/sitesv-images-rt/def=w1280", "2024 照片");
  await job("j5", 5, "b2024", "video", "https://www.youtube.com/watch?v=WixjrJYqB5E&t=863s", "香港");
  await run("UPDATE import_jobs SET start_sec = 863 WHERE id = 'j5'");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL | Request) => {
    const url = String(u);
    if (url.includes("playlistItems")) return new Response(JSON.stringify({ items: [{ snippet: { title: "舊的重複" }, contentDetails: { videoId: "AAAAAAAAAAA" } }, { snippet: { title: "新影片" }, contentDetails: { videoId: "BBBBBBBBBBB", videoPublishedAt: "2025-12-06T01:00:00Z" } }, { snippet: { title: "Private video" }, contentDetails: { videoId: "CCCCCCCCCCC" } }] }), { status: 200 });
    if (url.includes("sitesv-images-rt")) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
    return new Response("x", { status: 404 });
  }) as typeof fetch;
  try {
    assert.equal(await processImportJobs(env), 5);
  } finally {
    globalThis.fetch = realFetch;
  }
  const lessons = (await db.prepare("SELECT title, kind, media_ref, event_date, start_seconds, cover_key FROM lessons WHERE course_id = 'c1' ORDER BY position").all<{ title: string; kind: string; media_ref: string | null; event_date: string | null; start_seconds: number | null; cover_key: string | null }>()).results;
  assert.deepEqual(lessons.map((l) => l.title), ["2025年", "舊的", "新影片", "2025 表揚專刊", "2024年", "2024 照片", "香港"]);
  assert.equal(lessons[2]!.event_date, "2025-12-06");
  assert.equal(lessons[6]!.start_seconds, 863);
  assert.ok(lessons[4]!.cover_key?.startsWith("lesson/b2024/"));
  assert.equal(store.size, 2);
  const st = (await db.prepare("SELECT id, status, imported FROM import_jobs ORDER BY seq").all<{ id: string; status: string; imported: number }>()).results;
  assert.deepEqual(st.map((x) => `${x.status}:${x.imported}`), ["done:1", "done:1", "done:1", "done:1", "done:1"]);
});
