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

test("反向橋接：行動大學通知頁分頁用繳作業已驗證的會員編號、預設只有留言、沒設密鑰就顯示讀不到", async () => {
  const { handleApi } = await import("../src/api.ts");
  const db = createTestDb();
  const calls: { url: string; body: string; auth: string | null }[] = [];
  const real = globalThis.fetch;
  try {
    globalThis.fetch = (async (u: string, i: RequestInit) => {
      calls.push({ url: String(u), body: String(i.body), auth: new Headers(i.headers).get("authorization") });
      return new Response(JSON.stringify({ notices: [{ id: "x1", title: "有人回覆了你的留言", body: "內容", link: "/course/c1", read: false, createdAt: "2026-11-28T00:00:00.000Z" }, { id: "x2", title: "t", body: "b", link: "https://evil.example/", read: true, createdAt: "2026-11-27T00:00:00.000Z" }] }));
    }) as never;
    const get = (env: unknown) => handleApi(new Request("https://check.test/api/notices/learn", { headers: { authorization: "Bearer dev:m1" } }), { DB: db, FILES: {}, DEV_LOGIN: "on", ...(env as object) } as never);
    const off = (await (await get({})).json()) as { available: boolean };
    assert.equal(off.available, false);
    assert.equal(calls.length, 0, "沒設密鑰不該打對方");
    const r = (await (await get({ APP_BRIDGE_SECRET: SECRET })).json()) as { available: boolean; categories: string[]; notices: { link: string }[] };
    assert.equal(r.available, true);
    assert.deepEqual(r.categories, ["comment"]);
    assert.equal(r.notices[1]!.link, "/", "不是站內路徑的連結改成首頁");
    assert.equal(calls[0]!.url, "https://learn.hglobal1985.com/api/v2/internal/notices");
    assert.equal(calls[0]!.auth, `Bearer ${SECRET}`);
    assert.deepEqual(JSON.parse(calls[0]!.body), { member_id: "m1", categories: ["comment"], action: "list" });
  } finally {
    globalThis.fetch = real;
  }
});
