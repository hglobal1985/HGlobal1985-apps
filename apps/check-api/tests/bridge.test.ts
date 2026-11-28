import assert from "node:assert/strict";
import { test } from "node:test";
import { bridgeNotices } from "../src/routes/bridge.ts";
import { createTestDb } from "./sqlite-d1.ts";

const SECRET = "0123456789abcdef0123456789abcdef";
const call = (env: unknown, body: unknown, auth: string | null = `Bearer ${SECRET}`) =>
  bridgeNotices(new Request("https://x/api/internal/notices", { method: "POST", headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) }), env as never);

test("內部橋接：沒設或錯誤密鑰 401；只讀、只改指定會員的通知", async () => {
  const db = createTestDb();
  const env = { DB: db, APP_BRIDGE_SECRET: SECRET };
  await db.prepare("INSERT INTO notices (id, member_id, title, body, link) VALUES ('n1', 'm1', '標題', '內容', '/item/i1'), ('n2', 'm2', '別人的', '', '/')").run();
  assert.equal((await call({ DB: db }, { member_id: "m1", action: "list" })).status, 401);
  assert.equal((await call(env, { member_id: "m1", action: "list" }, "Bearer wrong")).status, 401);
  assert.equal((await call(env, { member_id: "m1", action: "list" }, null)).status, 401);
  assert.equal((await call(env, { action: "list" })).status, 400);
  const list = (await (await call(env, { member_id: "m1", action: "list" })).json()) as { notices: { id: string; read: boolean }[] };
  assert.deepEqual(list.notices.map((n) => n.id), ["n1"]);
  assert.equal(list.notices[0]!.read, false);
  await call(env, { member_id: "m1", action: "read", id: "n2" }); // 別人的通知不能被改
  assert.equal((await db.prepare("SELECT read_at FROM notices WHERE id = 'n2'").first<{ read_at: string | null }>())?.read_at, null);
  await call(env, { member_id: "m1", action: "read", id: "n1" });
  assert.ok((await db.prepare("SELECT read_at FROM notices WHERE id = 'n1'").first<{ read_at: string | null }>())?.read_at);
});
