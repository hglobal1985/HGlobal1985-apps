import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { CHECK_BACKUP_TABLES, runCheckBackup } from "../src/weekly-backup.ts";
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


const SENSITIVE = /(pw_hash|pw_salt|refresh_token|token|secret|password|join_code|code$|endpoint|p256dh|auth$|email|google|amway)/i;
const dir = new URL("../migrations/", import.meta.url);

test("每週備份：列出的資料表與欄位都真的存在，而且沒有敏感欄位", () => {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  for (const [table, cols] of Object.entries(CHECK_BACKUP_TABLES)) {
    const real = new Set((db.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    assert.ok(real.size, `${table} 不存在`);
    for (const c of cols) {
      assert.ok(real.has(c), `${table}.${c} 不存在`);
      assert.ok(!SENSITIVE.test(c), `${table}.${c} 看起來是敏感欄位`);
    }
  }
  for (const t of ["tickets", "zip_tickets", "push_subs", "invites", "people", "notices"]) assert.ok(!(t in CHECK_BACKUP_TABLES), `${t} 不可備份`);
});

test("每週備份：到時間才備份、寫 manifest、同一天只做一次、只留 keep 份、關閉就不做", async () => {
  const db = createTestDb();
  const bucket = memBackupBucket();
  const env = { DB: db, FILES: bucket } as never as Parameters<typeof runCheckBackup>[0];
  await db.prepare("INSERT INTO activities (id, title, join_code, created_by) VALUES ('a1', '備份測試活動', 'JC1', 'm1')").run();
  const cfg = { enabled: true, weekday: 0, keep: 2 };
  assert.equal(await runCheckBackup(env, new Date("2026-11-28T20:10:00Z"), cfg), 0, "不是 03 點不做");
  assert.equal(await runCheckBackup(env, new Date("2026-11-28T19:10:00Z"), null), 0, "功能關閉不做");
  assert.ok((await runCheckBackup(env, new Date("2026-11-28T19:10:00Z"), cfg)) > 0);
  const keys = bucket.keys();
  assert.ok(keys.includes("backups/2026-11-29/manifest.json") && keys.includes("backups/2026-11-29/README.txt"));
  const f = keys.find((k: string) => k.startsWith("backups/2026-11-29/activities."))!;
  assert.match(await new Response((await bucket.get(f))!.body).text(), /備份測試活動/);
  assert.equal(await runCheckBackup(env, new Date("2026-11-28T19:30:00Z"), cfg), 0, "同一天只做一次");
  for (const d of ["2026-12-06", "2026-12-13"]) await runCheckBackup(env, new Date(Date.parse(`${d}T00:00:00Z`) - 5 * 3600_000), cfg);
  assert.deepEqual([...new Set(bucket.keys().map((k: string) => k.split("/")[1]))].sort(), ["2026-12-06", "2026-12-13"]);
});
