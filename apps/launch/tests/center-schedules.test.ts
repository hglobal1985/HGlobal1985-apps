import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

// 最簡單的假 R2：只記得放進去的東西。
function memR2(): R2Bucket {
  const m = new Map<string, { body: Uint8Array; httpMetadata?: { contentType?: string } }>();
  return {
    put: async (k: string, v: ArrayBuffer | Uint8Array, o?: { httpMetadata?: { contentType?: string } }) => void m.set(k, { body: new Uint8Array(v as ArrayBuffer), httpMetadata: o?.httpMetadata }),
    get: async (k: string) => (m.has(k) ? { ...m.get(k)!, body: new Response(m.get(k)!.body).body } : null),
    delete: async (k: string) => void m.delete(k),
    list: async () => ({ objects: [...m.keys()].map((key) => ({ key, size: 1 })), truncated: false }),
    _keys: () => [...m.keys()],
  } as unknown as R2Bucket;
}
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 50 }, (_, i) => i)]);

test("中心每月課表：上傳、更換、查詢、刪除、權限與通知", async () => {
  const bucket = memR2();
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on", MEDIA: bucket };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown; bytes?: Uint8Array } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { ...(opts.bytes ? {} : { "content-type": "application/json" }), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: (opts.bytes as Uint8Array<ArrayBuffer> | undefined) ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) }), env);
    const text = await res.text();
    return { status: res.status, data: (text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const [admin, a] = await Promise.all([login("demo-admin"), login("demo-student")]);
  type Sch = { items: { ym: string; url: string }[] };
  const C = encodeURIComponent("台北中心");
  assert.deepEqual((await call<Sch>("GET", `/center-schedules?center=${C}`)).data.items, [], "沒上傳過是空的，訪客也能讀");
  await call("POST", "/center-subscription", { token: a, body: { center: "台北中心" } });

  assert.equal((await call("PUT", `/admin/center-schedules?center=${C}&ym=2026-11`, { token: a, bytes: jpeg })).status, 403, "一般會員不能上傳");
  assert.equal((await call("PUT", `/admin/center-schedules?center=${C}&ym=2026-13`, { token: admin, bytes: jpeg })).status, 400, "月份要正確");
  assert.equal((await call("PUT", `/admin/center-schedules?center=${C}&ym=2026-11`, { token: admin, bytes: new Uint8Array([1, 2, 3]) })).status, 400, "不是圖片");
  const up = await call<Sch>("PUT", `/admin/center-schedules?center=${C}&ym=2026-11`, { token: admin, bytes: jpeg });
  assert.equal(up.status, 200);
  assert.equal(up.data.items.length, 1);
  await call("PUT", `/admin/center-schedules?center=${C}&ym=2026-10`, { token: admin, bytes: jpeg });
  const list = (await call<Sch>("GET", `/center-schedules?center=${C}`)).data.items;
  assert.deepEqual(list.map((x) => x.ym), ["2026-11", "2026-10"], "新的月份在前");
  // 公開圖片網址可以讀到
  const img = await handleApi(new Request(`https://learn.test${list[0]!.url}`), env);
  assert.equal(img.status, 200);

  // 新月份通知訂閱者；上傳的人自己收到確認；更換同月不重複通知
  const titles = async (t: string) => (await call<{ title: string; body: string }[]>("GET", "/notifications", { token: t })).data;
  assert.equal((await titles(a)).filter((n) => n.title.includes("課表上架")).length, 2);
  assert.ok((await titles(admin)).some((n) => n.title === "已送出「課表上架」通知" && n.body.includes("通知了 1 位訂閱者")));
  const before = (bucket as unknown as { _keys: () => string[] })._keys().length;
  await call("PUT", `/admin/center-schedules?center=${C}&ym=2026-11`, { token: admin, bytes: jpeg });
  assert.equal((await titles(a)).filter((n) => n.title.includes("課表上架")).length, 2, "更換同一個月不再通知");
  assert.equal((bucket as unknown as { _keys: () => string[] })._keys().length, before, "更換後舊檔被刪掉，不留殘檔");

  assert.equal((await call("DELETE", `/admin/center-schedules?center=${C}&ym=2026-10`, { token: a })).status, 403);
  const del = await call<Sch>("DELETE", `/admin/center-schedules?center=${C}&ym=2026-10`, { token: admin });
  assert.deepEqual(del.data.items.map((x) => x.ym), ["2026-11"]);
  assert.equal((bucket as unknown as { _keys: () => string[] })._keys().length, before - 1, "刪除時連雲端檔案一起清掉");
});
