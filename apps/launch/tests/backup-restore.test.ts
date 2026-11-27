import assert from "node:assert/strict";
import { test } from "node:test";
import { listBackups, planRestore, runRestore, type RestoreBucket, type RestoreDb } from "../../../packages/server-shared/src/backup-restore.ts";
import { exportBackup, type BackupBucket, type BackupDb } from "../../../packages/server-shared/src/weekly-backup.ts";
import { createTestDb } from "./sqlite-d1.ts";

function memBucket() {
  const m = new Map<string, string>();
  const b = {
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
  return b as typeof b & RestoreBucket;
}

// 一對有連鎖刪除的資料表：還原不可因為覆蓋 my_lists 而把 my_list_items 刪掉。
const TABLES = { quotes: ["id", "body", "created_by", "created_at"], my_lists: ["id", "owner_sub", "owner_name", "title", "slug", "position", "number"], my_list_items: ["id", "list_id", "kind", "ref", "position"] };

test("還原：預覽、確認字樣、先備份現況、依主鍵補寫、不刪新資料、不觸發連鎖刪除", async () => {
  const raw = createTestDb();
  const db = raw as unknown as RestoreDb & BackupDb;
  const bucket = memBucket();
  await raw.prepare("INSERT INTO quotes (id, body, created_by) VALUES ('q1', '原文', 'x')").run();
  await raw.prepare("INSERT INTO my_lists (id, owner_sub, owner_name, title, slug, position, number) VALUES ('l1', 's1', 'n', '清單', 'a', 1, 1)").run();
  await raw.prepare("INSERT INTO my_list_items (id, list_id, kind, ref, position) VALUES ('i1', 'l1', 'course', 'c1', 1)").run();
  const now = new Date("2026-11-29T00:00:00Z");
  await exportBackup({ db, bucket: bucket as unknown as BackupBucket, appId: "learn", appLabel: "測試", tables: TABLES, now }, "backups/2026-11-29/", "2026-11-29");
  assert.deepEqual((await listBackups(bucket)).map((b) => b.date), ["2026-11-29"]);

  // 備份之後：改了一筆、新增一筆、刪掉一筆
  await raw.prepare("UPDATE quotes SET body = '被改掉' WHERE id = 'q1'").run();
  await raw.prepare("INSERT INTO quotes (id, body, created_by) VALUES ('q2', '備份後新增', 'x')").run();
  await raw.prepare("DELETE FROM my_list_items WHERE id = 'i1'").run();

  const plan = await planRestore(db, bucket, TABLES, "2026-11-29");
  assert.ok(plan && plan.tables.every((t) => t.supported) && !plan.problems.length);
  assert.equal(await planRestore(db, bucket, TABLES, "2026-01-01"), null);

  const base = { db, bucket, appId: "learn", appLabel: "測試", tables: TABLES, date: "2026-11-29", now: new Date("2026-11-30T01:02:03Z") };
  await assert.rejects(runRestore({ ...base, confirm: "" }), /confirm_mismatch/);
  assert.equal((await raw.prepare("SELECT body FROM quotes WHERE id = 'q1'").first<{ body: string }>())?.body, "被改掉", "確認失敗不動資料");

  const r = await runRestore({ ...base, confirm: "2026-11-29" });
  assert.ok(r.pre_restore.startsWith("backups/pre-restore-"));
  assert.ok(bucket.keys().some((k) => k.startsWith(r.pre_restore + "/") && k.endsWith("manifest.json")), "還原前備份已寫入");
  assert.equal((await raw.prepare("SELECT body FROM quotes WHERE id = 'q1'").first<{ body: string }>())?.body, "原文");
  assert.equal((await raw.prepare("SELECT body FROM quotes WHERE id = 'q2'").first<{ body: string }>())?.body, "備份後新增", "備份後新增的資料不刪");
  assert.equal((await raw.prepare("SELECT id FROM my_list_items WHERE id = 'i1'").first())?.id, "i1", "被刪的列補回來");
  assert.deepEqual((await listBackups(bucket)).map((b) => b.date), ["2026-11-29"], "還原前備份不列入一般備份清單");
});

test("還原：備份檔有清單外的欄位或不完整就中止，且不動資料", async () => {
  const raw = createTestDb();
  const db = raw as unknown as RestoreDb & BackupDb;
  const bucket = memBucket();
  await raw.prepare("INSERT INTO quotes (id, body, created_by) VALUES ('q1', '原文', 'x')").run();
  const now = new Date("2026-11-29T00:00:00Z");
  await exportBackup({ db, bucket: bucket as unknown as BackupBucket, appId: "learn", appLabel: "測試", tables: { quotes: TABLES.quotes }, now }, "backups/2026-11-29/", "x");
  await raw.prepare("UPDATE quotes SET body = '現況' WHERE id = 'q1'").run();
  const base = { db, bucket, appId: "learn", appLabel: "測試", date: "2026-11-29", confirm: "2026-11-29", now };
  await assert.rejects(runRestore({ ...base, tables: { quotes: ["id", "body"] } }), /backup_mismatch/);
  await assert.rejects(runRestore({ ...base, tables: { my_lists: TABLES.my_lists } }), /backup_mismatch/);
  await bucket.put("backups/2026-11-29/quotes.1.ndjson", "");
  await assert.rejects(runRestore({ ...base, tables: { quotes: TABLES.quotes } }), /backup_incomplete/);
  assert.equal((await raw.prepare("SELECT body FROM quotes WHERE id = 'q1'").first<{ body: string }>())?.body, "現況");
});
