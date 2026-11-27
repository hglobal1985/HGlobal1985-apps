import assert from "node:assert/strict";
import { test } from "node:test";
import { runWeeklyBackup, type BackupBucket, type BackupDb } from "../../../packages/server-shared/src/weekly-backup.ts";
import { BACKUP_TABLES, weeklyBackup } from "../src/weekly-backup.ts";
import { setCentralFetch } from "../src/central.ts";
import { createTestDb, memR2 } from "./sqlite-d1.ts";

const SUN_0330 = Date.UTC(2026, 10, 28, 19, 30); // 台北 2026-11-29（日）03:30

test("繳作業備份：成績資料的每個欄位都存在於資料表，且不含檔案、留言、暫存", async () => {
  const db = createTestDb();
  await db.prepare("INSERT INTO activities (id, title, join_code, created_by) VALUES ('a1','美力之星','jc1','m1')").run();
  await db.prepare("INSERT INTO submissions (id, item_id, activity_id, member_id, status, score) VALUES ('s1','i1','a1','m2','graded',90)").run();
  const store = new Map<string, string>();
  const bucket = { put: async (k: string, v: string) => void store.set(k, v), head: async (k: string) => (store.has(k) ? {} : null), delete: async () => {}, list: async () => ({ objects: [], delimitedPrefixes: [], truncated: false }) };
  const r = await runWeeklyBackup({ db: db as unknown as BackupDb, bucket: bucket as unknown as BackupBucket, tables: BACKUP_TABLES, appName: "x", config: { enabled: true, weekday: 0, keep: 4 }, now: SUN_0330 });
  assert.equal(r.status, "ok");
  assert.deepEqual(JSON.parse(store.get("backups/2026-11-29/submissions.001.ndjson")!.trim()).score, 90);
  assert.ok(![...store.keys()].some((k) => /files|comments|tickets|notices|people|push_subs/.test(k)));
});

test("繳作業排程：備份失敗通知最近用過的超級管理員（只送一次）", async () => {
  const db = createTestDb();
  await db.prepare("INSERT INTO super_admins (member_id) VALUES ('sa1')").run();
  await db.prepare("INSERT INTO super_admins (member_id, seen_at) VALUES ('old', '2020-01-01T00:00:00Z')").run();
  const files = memR2();
  files.put = async () => { throw new Error("r2 down"); };
  setCentralFetch(async () => new Response(JSON.stringify({ config: { eco_features: { weekly_backup: { enabled: true, weekday: 0, keep: 4 } } } })));
  const sent: string[][] = [];
  const env = { DB: db, FILES: files } as never;
  const notify = async (ids: string[]) => void sent.push(ids);
  assert.equal((await weeklyBackup(env, notify, SUN_0330)).status, "failed");
  assert.equal((await weeklyBackup(env, notify, SUN_0330)).status, "failed");
  assert.deepEqual(sent, [["sa1"]]);
});
