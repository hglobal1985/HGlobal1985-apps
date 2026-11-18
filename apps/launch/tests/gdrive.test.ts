import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const SESSION = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc123";

/** 假的 Google：記錄收到的請求，模擬授權、換通行證、建資料夾、可續傳上傳。 */
function fakeGoogle(opts: { invalidGrant?: boolean; full?: boolean } = {}) {
  const calls: { url: string; method: string; range?: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ url, method, range: headers.get("content-range") ?? undefined });
    const j = (o: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...h } });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const body = String(init?.body);
      if (body.includes("refresh_token") && opts.invalidGrant) return j({ error: "invalid_grant" }, 400);
      return j({ access_token: "at-1", refresh_token: "rt-1" });
    }
    if (url.startsWith("https://www.googleapis.com/oauth2/v2/userinfo")) return j({ email: "hglobal1985@gmail.com" });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files")) return j({ id: "folder-1" });
    if (method === "POST" && url.startsWith("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable")) return new Response("", { status: 200, headers: { location: SESSION } });
    if (url === SESSION) {
      if (opts.full) return j({ error: { errors: [{ reason: "storageQuotaExceeded" }] } }, 403);
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(headers.get("content-range") ?? "")!;
      if (Number(m[2]) + 1 < Number(m[3])) return new Response("", { status: 308, headers: { range: `bytes=0-${m[2]}` } });
      return j({ id: "file-1", name: "a.pdf", size: m[3], webViewLink: "https://drive.google.com/file/d/file-1/view" }, 200);
    }
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) return new Response("", { status: 200 });
    return j({}, 404);
  }) as typeof fetch;
  return calls;
}

test("雲端硬碟上傳：授權、分段上傳、紀錄與權限", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on", GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown; raw?: ArrayBuffer } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, redirect: "manual", headers: { ...(opts.raw ? {} : { "content-type": "application/json" }), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) }), env);
    return { status: res.status, res, data: (res.headers.get("content-type") ?? "").includes("json") ? ((await res.json()) as T) : (null as T) };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const admin = await login("demo-admin");
  const student = await login("demo-student");
  const calls = fakeGoogle();

  // 沒連結：管理員看得到狀態、不能上傳；學員完全不行
  const st0 = await call<{ configured: boolean; connected: boolean }>("GET", "/admin/drive", { token: admin });
  assert.deepEqual([st0.data.configured, st0.data.connected], [true, false]);
  assert.equal((await call("GET", "/admin/drive", { token: student })).status, 403);
  assert.equal((await call("POST", "/admin/drive/uploads", { token: admin, body: { name: "a.pdf", size: 10 } })).status, 503);

  // 超級管理員才能連結；產生的授權網址要求離線存取
  assert.equal((await call("POST", "/admin/drive/connect", { token: student })).status, 403);
  const { url } = (await call<{ url: string }>("POST", "/admin/drive/connect", { token: admin })).data;
  const u = new URL(url);
  assert.equal(u.hostname, "accounts.google.com");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.ok(u.searchParams.get("scope")!.includes("drive.file"));
  assert.ok(!u.searchParams.get("scope")!.includes("auth/drive "), "不可要求完整雲端硬碟權限");
  const state = u.searchParams.get("state")!;

  // 偽造的回呼不會連結；真的一次有效
  const forged = await call("GET", `/admin/drive/callback?code=x&state=nope`);
  assert.match(forged.res.headers.get("location") ?? "", /drive=denied/);
  const ok = await call("GET", `/admin/drive/callback?code=abc&state=${state}`);
  assert.match(ok.res.headers.get("location") ?? "", /drive=ok/);
  assert.match((await call("GET", `/admin/drive/callback?code=abc&state=${state}`)).res.headers.get("location") ?? "", /denied/, "state 用過即失效");
  const st1 = await call<{ connected: boolean; account: string; folder: string }>("GET", "/admin/drive", { token: admin });
  assert.deepEqual([st1.data.connected, st1.data.account, st1.data.folder], [true, "hglobal1985@gmail.com", "行動大學上傳"]);
  assert.ok(!JSON.stringify(st1.data).includes("rt-1"), "通行證不能回傳前端");

  // 分段上傳：第一段 308、最後一段完成並寫入紀錄
  const start = await call<{ session: string }>("POST", "/admin/drive/uploads", { token: admin, body: { name: "../a.pdf", size: 300, mime: "application/pdf" } });
  assert.equal(start.status, 200);
  const q = (s: number, t: number) => `/admin/drive/uploads/chunk?session=${encodeURIComponent(start.data.session)}&start=${s}&total=${t}`;
  const c1 = await call<{ done: boolean; next: number }>("PUT", q(0, 300), { token: admin, raw: new ArrayBuffer(256) });
  assert.deepEqual([c1.data.done, c1.data.next], [false, 256]);
  const c2 = await call<{ done: boolean }>("PUT", q(256, 300), { token: admin, raw: new ArrayBuffer(44) });
  assert.equal(c2.data.done, true);
  assert.equal(calls.find((c) => c.range === "bytes 256-299/300")?.method, "PUT");
  const mine = await call<{ uploads: { name: string; link: string; by: string }[] }>("GET", "/admin/drive", { token: admin });
  assert.equal(mine.data.uploads.length, 1);
  assert.ok(mine.data.uploads[0]!.link.includes("drive.google.com"), "超級管理員看得到連結");

  // 不是 Google 的上傳位址一律擋下
  assert.equal((await call("PUT", `/admin/drive/uploads/chunk?session=${encodeURIComponent("https://evil.test/x?upload_id=1")}&start=0&total=10`, { token: admin, raw: new ArrayBuffer(10) })).status, 400);
  assert.equal((await call("POST", "/admin/drive/uploads", { token: admin, body: { name: "big", size: 3 * 1024 ** 3 } })).status, 413);

  // 取消連結
  assert.equal((await call("DELETE", "/admin/drive/connect", { token: admin })).status, 200);
  assert.equal((await call<{ connected: boolean }>("GET", "/admin/drive", { token: admin })).data.connected, false);
});

test("雲端硬碟上傳：授權失效與容量已滿的提示", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on", GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec" };
  const call = async (method: string, path: string, token: string, body?: unknown, raw?: ArrayBuffer) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(raw ? {} : { "content-type": "application/json" }) }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }), env);
    return { status: res.status, data: (await res.json()) as Record<string, any> };
  };
  const admin = ((await (await handleApi(new Request("https://learn.test/api/v2/auth/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sub: "demo-admin" }) }), env)).json()) as { token: string }).token;
  await db.prepare("INSERT INTO drive_link (id, refresh_token, folder_id, connected_by) VALUES (1, 'rt', 'f1', 'demo-admin')").run();

  fakeGoogle({ full: true });
  const s = await call("POST", "/admin/drive/uploads", admin, { name: "a.pdf", size: 10 });
  const full = await call("PUT", `/admin/drive/uploads/chunk?session=${encodeURIComponent(s.data.session)}&start=0&total=10`, admin, undefined, new ArrayBuffer(10));
  assert.equal(full.status, 507);
  assert.match(full.data.error.message, /容量已滿/);

  fakeGoogle({ invalidGrant: true });
  const bad = await call("POST", "/admin/drive/uploads", admin, { name: "a.pdf", size: 10 });
  assert.equal(bad.status, 503);
  const st = await call("GET", "/admin/drive", admin);
  assert.deepEqual([st.data.connected, st.data.broken], [false, true]);
});
