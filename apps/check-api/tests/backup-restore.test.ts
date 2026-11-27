import assert from "node:assert/strict";
import { test } from "node:test";
import { runRestore, type RestoreBucket, type RestoreDb } from "../../../packages/server-shared/src/backup-restore.ts";
import { CHECK_BACKUP_TABLES, runCheckBackup } from "../src/weekly-backup.ts";
import { createTestDb } from "./sqlite-d1.ts";

function memBucket() {
  const m = new Map<string, string>();
  return {
    put: async (k: string, v: string) => void m.set(k, v),
    head: async (k: string) => (m.has(k) ? {} : null),
    get: async (k: string) => (m.has(k) ? { text: async () => m.get(k)! } : null),
    delete: async (k: string | string[]) => void (Array.isArray(k) ? k : [k]).forEach((x) => m.delete(x)),
    list: async (o: { prefix: string; delimiter?: string }) => {
      const keys = [...m.keys()].filter((k) => k.startsWith(o.prefix));
      if (!o.delimiter) return { objects: keys.map((key) => ({ key })), delimitedPrefixes: [] as string[], truncated: false };
      const dirs = new Set(keys.map((k) => k.slice(0, o.prefix.length + k.slice(o.prefix.length).indexOf(o.delimiter!) + 1)));
      return { objects: [] as { key: string }[], delimitedPrefixes: [...dirs], truncated: false };
    },
    keys: () => [...m.keys()],
  };
}

test("繳作業系統還原：改回備份內容、必填欄位不在備份的已刪列只計數、備份後新增的不刪", async () => {
  const db = createTestDb();
  const bucket = memBucket();
  const env = { DB: db, FILES: bucket } as never as Parameters<typeof runCheckBackup>[0];
  await db.prepare("INSERT INTO activities (id, title, join_code, created_by) VALUES ('a1', '原標題', 'JC1', 'm1')").run();
  await db.prepare("INSERT INTO activities (id, title, join_code, created_by) VALUES ('a2', '會被刪', 'JC2', 'm1')").run();
  await runCheckBackup(env, new Date("2026-11-28T19:10:00Z"), { enabled: true, weekday: 0, keep: 4 });
  await db.prepare("UPDATE activities SET title = '被改掉' WHERE id = 'a1'").run();
  await db.prepare("DELETE FROM activities WHERE id = 'a2'").run();
  await db.prepare("INSERT INTO activities (id, title, join_code, created_by) VALUES ('a3', '備份後新增', 'JC3', 'm1')").run();
  const base = { db: db as unknown as RestoreDb, bucket: bucket as unknown as RestoreBucket, appId: "check", appLabel: "繳作業系統", tables: CHECK_BACKUP_TABLES, date: "2026-11-29", now: new Date("2026-11-30T00:00:00Z") };
  await assert.rejects(runRestore({ ...base, confirm: "x" }), /confirm_mismatch/);
  const r = await runRestore({ ...base, confirm: "2026-11-29" });
  assert.equal((await db.prepare("SELECT title FROM activities WHERE id = 'a1'").first<{ title: string }>())?.title, "原標題");
  assert.equal((await db.prepare("SELECT title FROM activities WHERE id = 'a3'").first<{ title: string }>())?.title, "備份後新增");
  assert.equal(await db.prepare("SELECT id FROM activities WHERE id = 'a2'").first(), null, "join_code 不在備份裡，刪掉的活動補不回來");
  assert.equal(r.restored.activities, 1);
  assert.equal(r.not_restored.activities, 1);
  assert.ok(bucket.keys().some((k) => k.startsWith(r.pre_restore + "/manifest.json")));
});
