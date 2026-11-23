import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("通知：審核相關而且還沒處理的標 pending（待審報名看報名狀態、其他審核通知看有沒有讀）（業主 2026-11-23）", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  const call = async (method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: await res.json() };
  };
  const token = ((await call("POST", "/auth/demo", { body: { sub: "demo-student" } })).data as { token: string }).token;
  const put = (id: string, title: string, link: string, read: boolean) =>
    db.prepare("INSERT INTO notifications (id, recipient_sub, title, link, read_at) VALUES (?, 'demo-student', ?, ?, ?)").bind(id, title, link, read ? "2026-11-23T00:00:00Z" : null).run();
  const order = (id: string, status: string) =>
    db.prepare("INSERT INTO orders (id, member_sub, member_name_snapshot, status, total_twd) VALUES (?, 'someone', 'x', ?, 100)").bind(id, status).run();
  await order("o-pending", "pending");
  await order("o-done", "opened");
  await put("n1", "有新的報名待審核", "/admin/orders/o-pending", true); // 已讀但報名還在待審 → 置頂
  await put("n2", "有新的報名待審核", "/admin/orders/o-done", false); // 報名已被別人處理 → 不置頂（就算沒讀）
  await put("n3", "你的獎銜申請有結果了", "/settings", false); // 審核結果還沒讀 → 置頂
  await put("n4", "你的獎銜申請有結果了", "/settings", true); // 已讀 → 不置頂
  await put("n5", "有新課程上架", "/courses", false); // 不是審核 → 不置頂
  const list = (await call("GET", "/notifications", { token })).data as { id: string; category: string; pending?: boolean }[];
  const flag = Object.fromEntries(list.map((n) => [n.id, !!n.pending]));
  assert.deepEqual(flag, { n1: true, n2: false, n3: true, n4: false, n5: false });
});
