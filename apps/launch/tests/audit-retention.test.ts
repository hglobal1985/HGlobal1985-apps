import assert from "node:assert/strict";
import { test } from "node:test";
import { pruneAuditLog, pruneNotifications } from "../src/audit-retention.ts";
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

test("站內通知：已讀半年、未讀一年後刪除；付費相關（報名紀錄）永久保留", async () => {
  const db = createTestDb();
  const ago = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
  const add = (id: string, link: string, at: string, read: string | null) =>
    db.prepare("INSERT INTO notifications (id, recipient_sub, title, link, read_at, created_at) VALUES (?, 'm', 't', ?, ?, ?)").bind(id, link, read, at).run();
  await add("read-old", "/course/x", ago(200), ago(199));
  await add("read-new", "/course/x", ago(30), ago(29));
  await add("unread-200", "/course/x", ago(200), null);
  await add("unread-400", "/course/x", ago(400), null);
  await add("order-old", "/orders/abc", ago(800), ago(799));
  assert.equal(await pruneNotifications(db), 2);
  const left = (await db.prepare("SELECT id FROM notifications ORDER BY id").all<{ id: string }>()).results.map((r) => r.id);
  assert.deepEqual(left, ["order-old", "read-new", "unread-200"]);
});
