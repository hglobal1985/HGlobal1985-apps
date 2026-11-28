import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

const SECRET = "0123456789abcdef0123456789abcdef";

test("內部橋接（接收端）：沒設或錯誤密鑰 401；只回該會員自己、指定類別（預設留言）的通知；已讀寫回", async () => {
  const db = createTestDb();
  const call = (env: Partial<Env>, body: unknown, auth: string | null = `Bearer ${SECRET}`) =>
    handleApi(new Request("https://learn.test/api/v2/internal/notices", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }), { DB: db, ...env } as Env);
  const ins = (id: string, sub: string, title: string, link: string) => db.prepare("INSERT INTO notifications (id, recipient_sub, title, body, link) VALUES (?, ?, ?, '內容', ?)").bind(id, sub, title, link).run();
  await ins("n1", "m1", "有人回覆了你的留言", "/course/c1");
  await ins("n2", "m1", "獲得學習徽章", "/achievements");
  await ins("n3", "m2", "有人回覆了你的留言", "/course/c2");
  assert.equal((await call({}, { member_id: "m1" })).status, 401, "沒設密鑰");
  assert.equal((await call({ APP_BRIDGE_SECRET: SECRET }, { member_id: "m1" }, "Bearer wrong")).status, 401);
  assert.equal((await call({ APP_BRIDGE_SECRET: SECRET }, { member_id: "m1" }, null)).status, 401);
  assert.equal((await call({ APP_BRIDGE_SECRET: SECRET }, {})).status, 400);
  const env = { APP_BRIDGE_SECRET: SECRET };
  const def = (await (await call(env, { member_id: "m1", action: "list" })).json()) as { notices: { id: string }[]; categories: string[] };
  assert.deepEqual(def.notices.map((n) => n.id), ["n1"]);
  assert.deepEqual(def.categories, ["comment"]);
  const both = (await (await call(env, { member_id: "m1", categories: ["comment", "achievement", "bogus"] })).json()) as { notices: { id: string }[] };
  assert.deepEqual(both.notices.map((n) => n.id).sort(), ["n1", "n2"]);
  // 別人的通知不能被改；不在選的類別裡的也不能被改
  await call(env, { member_id: "m1", action: "read", id: "n3" });
  assert.equal((await db.prepare("SELECT read_at FROM notifications WHERE id = 'n3'").first<{ read_at: string | null }>())?.read_at, null);
  await call(env, { member_id: "m1", action: "read", id: "n2" });
  assert.equal((await db.prepare("SELECT read_at FROM notifications WHERE id = 'n2'").first<{ read_at: string | null }>())?.read_at, null, "成就類別沒被選");
  await call(env, { member_id: "m1", action: "read", id: "n1" });
  assert.ok((await db.prepare("SELECT read_at FROM notifications WHERE id = 'n1'").first<{ read_at: string | null }>())?.read_at);
});
