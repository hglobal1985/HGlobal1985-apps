import assert from "node:assert/strict";
import { test } from "node:test";
import type { Env } from "../src/d1.ts";
import { driveTitle, folderIdOf, getAutoSync, parseDriveName, PLATINUM_FORMAT, processWeeklySyncs, runDriveSync, setAutoSync } from "../src/drive-sync.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("雲端資料夾同步：連結判讀與檔名解析成統一格式", () => {
  assert.equal(folderIdOf("https://drive.google.com/drive/folders/1bckEgllJGpG7NGSAVyBZwUtHkUFFsVzY?usp=drive_link"), "1bckEgllJGpG7NGSAVyBZwUtHkUFFsVzY");
  assert.equal(folderIdOf("https://example.com/x"), null);
  const f = { id: "a", name: "202611 線上白金溝通會（淨熱組/公益/悅齡錠）.pdf", modified: "2026-11-26T00:00:00Z" };
  assert.equal(driveTitle(PLATINUM_FORMAT, f), "簡報2026年11月 白金溝通會");
  assert.equal(driveTitle(PLATINUM_FORMAT, { id: "b", name: "202603 線上白金溝通會.pdf", modified: null }), "簡報2026年3月 白金溝通會");
  assert.equal(driveTitle("{標題}", f), "202611 線上白金溝通會（淨熱組/公益/悅齡錠）");
  assert.equal(parseDriveName("說明.pdf", "2026-05-02T00:00:00Z").ym, "2026-05-01"); // 檔名沒有年月就用修改日
});

test("雲端資料夾同步：只加新檔案、放進區塊、最新的在最上面、再按不重複", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, GOOGLE_DRIVE_API_KEY: "k" };
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await run("INSERT INTO courses (id, title, status) VALUES ('c1', '白金溝通會', 'published')");
  await run("INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type, kind) VALUES ('blk', 'c1', 1, '簡報', 0, 'demo', 'section')");
  await run("INSERT INTO drive_syncs (id, url, folder_id, course_id, block_id, title_format) VALUES ('d1', 'u', 'FOLDER12345', 'c1', 'blk', ?)", PLATINUM_FORMAT);
  const files = [
    { id: "F202610", name: "202610 線上白金溝通會（A）.pdf", mimeType: "application/pdf", modifiedTime: "2026-11-26T00:00:00Z" },
    { id: "F202611", name: "202611 線上白金溝通會（B）.pdf", mimeType: "application/pdf", modifiedTime: "2026-11-01T00:00:00Z" },
    { id: "SUBFLD", name: "子資料夾", mimeType: "application/vnd.google-apps.folder" },
  ];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL | Request) => {
    const url = String(u);
    if (url.includes("googleapis.com/drive/v3/files")) return new Response(JSON.stringify({ files: url.includes("SUBFLD") ? [{ id: "F202609", name: "202609 線上白金溝通會.pdf", mimeType: "application/pdf" }] : files }), { status: 200 });
    return new Response("x", { status: 404 });
  }) as typeof fetch;
  try {
    const a = await runDriveSync(env, "d1");
    assert.equal(a.imported, 3);
    assert.equal(a.total, 3);
    const rows = (await db.prepare("SELECT title FROM lessons WHERE course_id = 'c1' AND kind = 'material' ORDER BY position").all<{ title: string }>()).results;
    assert.deepEqual(rows.map((r) => r.title), ["簡報2026年11月 白金溝通會", "簡報2026年10月 白金溝通會", "簡報2026年9月 白金溝通會"]);
    const first = await db.prepare("SELECT kind FROM lessons WHERE course_id = 'c1' ORDER BY position LIMIT 1").first<{ kind: string }>();
    assert.equal(first?.kind, "section");
    const att = await db.prepare("SELECT link_url, att_type FROM lesson_attachments WHERE course_id = 'c1' LIMIT 1").first<{ link_url: string; att_type: string }>();
    assert.match(att!.link_url, /^https:\/\/drive\.google\.com\/file\/d\/F2026/);
    assert.equal(att!.att_type, "google_drive");
    const b = await runDriveSync(env, "d1");
    assert.equal(b.imported, 0);
    assert.equal(b.total, 3);
    const sync = await db.prepare("SELECT last_total, last_imported FROM drive_syncs WHERE id = 'd1'").first<{ last_total: number; last_imported: number }>();
    assert.equal(sync?.last_total, 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("自動同步：預設每週一次，超過 7 天才同步，可關閉", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, GOOGLE_DRIVE_API_KEY: "k" };
  await db.prepare("INSERT INTO courses (id, title, status) VALUES ('c1', 'x', 'published')").run();
  const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
  await db.prepare("INSERT INTO drive_syncs (id, url, folder_id, course_id, last_synced_at) VALUES ('d1', 'u', 'FOLDER12345', 'c1', ?)").bind(old).run();
  await db.prepare("INSERT INTO drive_syncs (id, url, folder_id, course_id, last_synced_at) VALUES ('d2', 'u', 'FOLDER67890', 'c1', ?)").bind(new Date().toISOString()).run();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ files: [] }), { status: 200 })) as typeof fetch;
  try {
    assert.equal((await getAutoSync(db)).weekly, true);
    await setAutoSync(db, false);
    assert.equal(await processWeeklySyncs(env), 0);
    await setAutoSync(db, true);
    assert.equal(await processWeeklySyncs(env), 1); // 只有超過 7 天的 d1
  } finally {
    globalThis.fetch = realFetch;
  }
});
