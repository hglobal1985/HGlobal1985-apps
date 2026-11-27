import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchBackupConfig, pruneBackups, runWeeklyBackup, taipeiParts, type BackupBucket, type BackupDb } from "../../../packages/server-shared/src/weekly-backup.ts";
import { BACKUP_TABLES, weeklyBackup } from "../src/weekly-backup.ts";
import { setCentralFetch } from "../src/central.ts";
import { createTestDb } from "./sqlite-d1.ts";

/** 記憶體版 R2（list 支援 prefix／delimiter）。 */
function fakeBucket() {
  const m = new Map<string, string>();
  const b: BackupBucket & { m: Map<string, string> } = {
    m,
    put: async (k, v) => void m.set(k, v),
    head: async (k) => (m.has(k) ? {} : null),
    delete: async (k) => void (Array.isArray(k) ? k : [k]).forEach((x) => m.delete(x)),
    list: async ({ prefix = "", delimiter }) => {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      if (!delimiter) return { objects: keys.map((key) => ({ key })), delimitedPrefixes: [], truncated: false };
      const pre = new Set(keys.map((k) => prefix + k.slice(prefix.length).split(delimiter)[0] + delimiter));
      return { objects: [], delimitedPrefixes: [...pre], truncated: false };
    },
  };
  return b;
}
// 2026-11-29 是星期日；台北 03:30 ＝ UTC 前一天 19:30
const SUN_0330 = Date.UTC(2026, 10, 28, 19, 30);

test("台北時間的日期、星期、小時", () => {
  assert.deepEqual(taipeiParts(SUN_0330), { date: "2026-11-29", weekday: 0, hour: 3 });
});

test("備份設定：沒有、關閉、格式不對都視為不備份", async () => {
  const get = (body: unknown, ok = true) => async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 });
  assert.deepEqual(await fetchBackupConfig("https://c", "x", get({ config: { eco_features: { weekly_backup: { enabled: true, weekday: 0, keep: 4 } } } })), { enabled: true, weekday: 0, keep: 4 });
  assert.equal(await fetchBackupConfig("https://c", "x", get({ config: {} })), null);
  assert.equal(await fetchBackupConfig("https://c", "x", get({ config: { eco_features: { weekly_backup: { enabled: false, weekday: 0, keep: 4 } } } })), null);
  assert.equal(await fetchBackupConfig("https://c", "x", get({ config: { eco_features: { weekly_backup: { enabled: true, weekday: 9, keep: 4 } } } })), null);
  assert.equal(await fetchBackupConfig("https://c", "x", get({}, false)), null);
});

test("行動大學備份：只匯出列出的欄位與永久保留的資料，分檔、manifest 最後寫、同一天只做一次", async () => {
  const db = createTestDb();
  await db.prepare("INSERT INTO audit_log (id, actor_sub, action, target_type, target_id) VALUES ('a1','m','order.paid','order','o1'), ('a2','m','course.update','course','c1')").run();
  await db.prepare("INSERT INTO sessions (token_hash, member_sub, name, roles, expires_at) VALUES ('h','m','n','[]','2099-01-01')").run().catch(() => {});
  const bucket = fakeBucket();
  const cfg = { enabled: true, weekday: 0, keep: 2 };
  const r = await runWeeklyBackup({ db: db as unknown as BackupDb, bucket, tables: BACKUP_TABLES, appName: "行動大學", config: cfg, now: SUN_0330 });
  assert.equal(r.status, "ok");
  const keys = [...bucket.m.keys()];
  assert.ok(keys.every((k) => k.startsWith("backups/2026-11-29/")));
  assert.ok(keys.includes("backups/2026-11-29/README.txt") && keys.includes("backups/2026-11-29/manifest.json"));
  const audit = bucket.m.get("backups/2026-11-29/audit_log.001.ndjson")!.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(audit.map((a) => a.id), ["a1"]); // 一般操作紀錄不備份
  assert.ok(!keys.some((k) => /sessions|courses\./.test(k))); // 暫存與內容不備份
  const manifest = JSON.parse(bucket.m.get("backups/2026-11-29/manifest.json")!);
  assert.equal(manifest.total_rows, manifest.files.reduce((n: number, f: { rows: number }) => n + f.rows, 0));
  // 同一天第二次略過
  assert.deepEqual(await runWeeklyBackup({ db: db as unknown as BackupDb, bucket, tables: BACKUP_TABLES, appName: "x", config: cfg, now: SUN_0330 + 600_000 }), { status: "skipped", reason: "done" });
});

test("備份時間：關閉、不是設定的星期、03:00 前、06:00 後都不做", async () => {
  const db = createTestDb();
  const bucket = fakeBucket();
  const run = (config: { enabled: boolean; weekday: number; keep: number } | null, now: number) => runWeeklyBackup({ db: db as unknown as BackupDb, bucket, tables: BACKUP_TABLES, appName: "x", config, now });
  assert.equal((await run(null, SUN_0330)).status, "skipped");
  assert.deepEqual(await run({ enabled: true, weekday: 1, keep: 2 }, SUN_0330), { status: "skipped", reason: "not-today" });
  assert.deepEqual(await run({ enabled: true, weekday: 0, keep: 2 }, SUN_0330 - 2 * 3600_000), { status: "skipped", reason: "too-early" });
  assert.deepEqual(await run({ enabled: true, weekday: 0, keep: 2 }, SUN_0330 + 3 * 3600_000), { status: "skipped", reason: "too-late" });
  assert.equal(bucket.m.size, 0);
});

test("備份失敗：沒有 manifest、通知只送一次、之後可重試", async () => {
  const db = createTestDb();
  const bucket = fakeBucket();
  let told = 0;
  const bad = [{ table: "orders", columns: ["no_such_column"] }];
  const cfg = { enabled: true, weekday: 0, keep: 2 };
  const go = () => runWeeklyBackup({ db: db as unknown as BackupDb, bucket, tables: bad, appName: "x", config: cfg, now: SUN_0330, onFailure: async () => void told++ });
  assert.equal((await go()).status, "failed");
  assert.equal((await go()).status, "failed");
  assert.equal(told, 1);
  assert.ok(!bucket.m.has("backups/2026-11-29/manifest.json"));
});

test("只留最近 keep 份，日期以外的路徑不動", async () => {
  const bucket = fakeBucket();
  for (const d of ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22"]) await bucket.put(`backups/${d}/manifest.json`, "{}");
  await bucket.put("backups/other/x", "x");
  await bucket.put("covers/a.jpg", "x");
  assert.equal(await pruneBackups(bucket, 2), 2);
  assert.deepEqual([...bucket.m.keys()].sort(), ["backups/2026-11-15/manifest.json", "backups/2026-11-22/manifest.json", "backups/other/x", "covers/a.jpg"]);
});

test("行動大學排程：中央沒開備份就不動；開了且失敗會通知全體管理員", async () => {
  const db = createTestDb();
  const bucket = fakeBucket();
  setCentralFetch(async () => new Response(JSON.stringify({ config: {} })));
  assert.equal((await weeklyBackup({ DB: db, MEDIA: bucket }, SUN_0330)).status, "skipped");
  setCentralFetch(async () => new Response(JSON.stringify({ config: { eco_features: { weekly_backup: { enabled: true, weekday: 0, keep: 4 } } } })));
  assert.equal((await weeklyBackup({ DB: db, MEDIA: bucket }, SUN_0330)).status, "ok");
  bucket.m.clear();
  bucket.put = async () => { throw new Error("r2 down"); };
  assert.equal((await weeklyBackup({ DB: db, MEDIA: bucket }, SUN_0330 + 7 * 86400_000)).status, "failed"); // 隔週（通知一天只送一次，日期要和上一個測試不同）
  const n = await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE recipient_role = 'admin' AND title = '每週備份失敗'").first<{ n: number }>();
  assert.equal(n!.n, 1);
  setCentralFetch((i, init) => fetch(i, init));
});
