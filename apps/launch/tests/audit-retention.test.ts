import assert from "node:assert/strict";
import { test } from "node:test";
import { pruneAuditLog } from "../src/audit-retention.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("稽核紀錄保存 3 個月；付費相關（order）與留言（comment）永久保留", async () => {
  const db = createTestDb();
  const old = new Date(Date.now() - 100 * 86400_000).toISOString();
  const recent = new Date(Date.now() - 5 * 86400_000).toISOString();
  const add = (id: string, action: string, type: string, at: string) =>
    db.prepare("INSERT INTO audit_log (id, actor_sub, action, target_type, target_id, created_at) VALUES (?, 'm', ?, ?, 'x', ?)").bind(id, action, type, at).run();
  await add("a", "course.update", "course", old);
  await add("b", "course.update", "course", recent);
  await add("c", "order.paid", "order", old);
  await add("d", "comment.hide", "comment", old);
  await add("e", "order.view_legal_name", "order", old);
  assert.equal(await pruneAuditLog(db), 1);
  const left = (await db.prepare("SELECT id FROM audit_log ORDER BY id").all<{ id: string }>()).results.map((r) => r.id);
  assert.deepEqual(left, ["b", "c", "d", "e"]);
});
