import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { backupsToDelete, isBackupWindow, parseBackupConfig } from "../../../packages/server-shared/src/weekly-backup.ts";
import { LAUNCH_BACKUP_TABLES, runLaunchBackup } from "../src/weekly-backup.ts";
import { setCentralFetch, fetchEcoBackupConfig } from "../src/central.ts";
import { createTestDb } from "./sqlite-d1.ts";

/** 測試用的記憶體 R2（只做備份會用到的 put／head／list／delete）。 */
function memBackupBucket() {
  const m = new Map<string, string>();
  return {
    put: async (k: string, v: string) => void m.set(k, v),
    head: async (k: string) => (m.has(k) ? {} : null),
    get: async (k: string) => (m.has(k) ? { body: new Response(m.get(k)!).body! } : null),
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


const SENSITIVE = /(pw_hash|pw_salt|refresh_token|token|secret|password|invite_code|endpoint|p256dh|auth$|email|google|amway)/i;
const dir = new URL("../migrations/", import.meta.url);

test("每週備份：列出的資料表與欄位都真的存在，而且沒有敏感欄位", () => {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  for (const [table, cols] of Object.entries(LAUNCH_BACKUP_TABLES)) {
    const real = new Set((db.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    assert.ok(real.size, `${table} 不存在`);
    for (const c of cols) {
      assert.ok(real.has(c), `${table}.${c} 不存在`);
      assert.ok(!SENSITIVE.test(c), `${table}.${c} 看起來是敏感欄位`);
    }
  }
  for (const t of ["sessions", "drive_link", "libraries", "push_subscriptions", "member_contacts", "member_profiles", "download_tickets"]) assert.ok(!(t in LAUNCH_BACKUP_TABLES), `${t} 不可備份`);
});

test("每週備份：設定解析、時間窗與舊份清理", () => {
  assert.equal(parseBackupConfig({ config: {} }), null);
  assert.equal(parseBackupConfig({ config: { eco_features: { weekly_backup: { enabled: false, weekday: 1, keep: 4 } } } }), null);
  assert.deepEqual(parseBackupConfig({ config: { eco_features: { weekly_backup: { enabled: true, weekday: 1, keep: 4 } } } }), { enabled: true, weekday: 1, keep: 4 });
  assert.deepEqual(parseBackupConfig({ config: { eco_features: { weekly_backup: { enabled: true, weekday: 9, keep: 0 } } } }), { enabled: true, weekday: 0, keep: 8 });
  // 2026-11-29 星期日；台北 03:xx ＝ UTC 前一天 19:xx
  assert.ok(isBackupWindow(0, new Date("2026-11-28T19:10:00Z")));
  assert.ok(!isBackupWindow(0, new Date("2026-11-28T20:10:00Z")));
  assert.ok(!isBackupWindow(1, new Date("2026-11-28T19:10:00Z")));
  assert.deepEqual(backupsToDelete(["backups/2026-11-01/", "backups/2026-11-08/", "backups/2026-11-15/", "backups/x/"], 2), ["backups/2026-11-01/"]);
});

test("每週備份：到時間才備份、寫 manifest、同一天只做一次、只留 keep 份、關閉就不做", async () => {
  const env = { DB: createTestDb(), MEDIA: memBackupBucket() } as never as Parameters<typeof runLaunchBackup>[0];
  const db = (env as { DB: ReturnType<typeof createTestDb> }).DB;
  await db.prepare("INSERT INTO quotes (id, body, created_by) VALUES ('q-test', '備份測試', 'x')").run();
  const bucket = (env as unknown as { MEDIA: ReturnType<typeof memBackupBucket> }).MEDIA;
  const cfg = { enabled: true, weekday: 0, keep: 2 };
  assert.equal(await runLaunchBackup(env, new Date("2026-11-28T20:10:00Z"), cfg), 0, "不是 03 點不做");
  assert.equal(await runLaunchBackup(env, new Date("2026-11-28T19:10:00Z"), null), 0, "功能關閉不做");
  assert.ok((await runLaunchBackup(env, new Date("2026-11-28T19:10:00Z"), cfg)) > 0);
  const keys = bucket.keys();
  assert.ok(keys.includes("backups/2026-11-29/manifest.json") && keys.includes("backups/2026-11-29/README.txt"));
  const quotes = keys.find((k: string) => k.startsWith("backups/2026-11-29/quotes."))!;
  assert.match(await new Response((await bucket.get(quotes))!.body).text(), /備份測試/);
  assert.equal(await runLaunchBackup(env, new Date("2026-11-28T19:30:00Z"), cfg), 0, "同一天只做一次");
  for (const d of ["2026-12-06", "2026-12-13"]) {
    const now = new Date(Date.parse(`${d}T00:00:00Z`) - 5 * 3600_000); // 台北 d 03:00
    await runLaunchBackup(env, now, cfg);
  }
  const folders = new Set(bucket.keys().map((k: string) => k.split("/")[1]));
  assert.deepEqual([...folders].sort(), ["2026-12-06", "2026-12-13"]);
});

test("每週備份：讀中央設定（連不上或關閉回 null）", async () => {
  setCentralFetch(async () => new Response(JSON.stringify({ config: { eco_features: { weekly_backup: { enabled: true, weekday: 3, keep: 5 } } } })));
  assert.deepEqual(await fetchEcoBackupConfig(), { enabled: true, weekday: 3, keep: 5 });
  setCentralFetch(async () => new Response("{}", { status: 500 }));
  assert.equal(await fetchEcoBackupConfig(), null);
  setCentralFetch(async () => { throw new Error("down"); });
  assert.equal(await fetchEcoBackupConfig(), null);
  setCentralFetch((input, init) => fetch(input, init));
});
