import assert from "node:assert/strict";
import { test } from "node:test";
import { bridgeAuthorized } from "../../../packages/server-shared/src/app-bridge.ts";
import { loadCheckNotices, readCheckNotices } from "../src/check-notices.ts";

const SECRET = "0123456789abcdef0123456789abcdef";
const env = (s?: string) => ({ APP_BRIDGE_SECRET: s }) as never as Parameters<typeof loadCheckNotices>[0];

test("橋接密鑰：沒設、太短、不對、格式不對一律拒絕；對的才通過", () => {
  assert.equal(bridgeAuthorized(undefined, `Bearer ${SECRET}`), false);
  assert.equal(bridgeAuthorized("short", "Bearer short"), false);
  assert.equal(bridgeAuthorized(SECRET, null), false);
  assert.equal(bridgeAuthorized(SECRET, `Bearer ${SECRET}x`), false);
  assert.equal(bridgeAuthorized(SECRET, SECRET), false);
  assert.equal(bridgeAuthorized(SECRET, `Bearer ${SECRET}`), true);
});

test("繳作業通知：沒設密鑰就不打對方、讀得到就回清單（路徑只收站內、不帶密鑰到清單）、連不上回 available=false", async () => {
  const real = globalThis.fetch;
  const calls: { url: string; auth: string | null; body: string }[] = [];
  try {
    globalThis.fetch = (async (u: string, i: RequestInit) => {
      calls.push({ url: String(u), auth: new Headers(i.headers).get("authorization"), body: String(i.body) });
      return new Response(JSON.stringify({ notices: [{ id: "n1", title: "作業被退回重交", body: "請修改", link: "/item/i1", read: false, createdAt: "2026-11-28T00:00:00.000Z" }, { id: "n2", title: "x", body: "y", link: "https://evil.example/", read: true, createdAt: "2026-11-27T00:00:00.000Z" }] }));
    }) as never;
    const none = await loadCheckNotices(env(undefined), "m1");
    assert.equal(none.available, false);
    assert.equal(calls.length, 0, "沒設密鑰不該打對方");
    const r = await loadCheckNotices(env(SECRET), "m1");
    assert.equal(r.available, true);
    assert.equal(r.notices.length, 2);
    assert.equal(r.notices[1]!.link, "/", "不是站內路徑的連結改成首頁");
    assert.equal(calls[0]!.url, "https://check.hglobal1985.com/api/internal/notices");
    assert.equal(calls[0]!.auth, `Bearer ${SECRET}`);
    assert.deepEqual(JSON.parse(calls[0]!.body), { member_id: "m1", action: "list" });
    assert.ok(!JSON.stringify(r).includes(SECRET));
    globalThis.fetch = (async () => new Response("no", { status: 401 })) as never;
    assert.equal((await loadCheckNotices(env(SECRET), "m1")).available, false);
    assert.equal(await readCheckNotices(env(SECRET), "m1", "n1"), false);
    globalThis.fetch = (async () => { throw new Error("down"); }) as never;
    assert.equal((await loadCheckNotices(env(SECRET), "m1")).available, false);
  } finally {
    globalThis.fetch = real;
  }
});
