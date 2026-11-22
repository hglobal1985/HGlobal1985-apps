import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("清單封面：封面類型、文字封面底圖、管理員底圖清單與權限", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const [admin, me] = await Promise.all([login("demo-admin"), login("demo-student")]);
  await env.DB.prepare("INSERT INTO list_cover_bgs (id, name, image_key) VALUES ('gtest123', '測試底圖', 'listbg/gtest123/a.jpg')").run();

  const made = await call<{ id: string }>("POST", "/my-lists", { token: me, body: { title: "新夥伴必看" } });
  const id = made.data.id;
  const d0 = (await call<{ coverMode: string; coverBgUrl: string | null; coverColor: string | null }>("GET", `/my-lists/${id}`, { token: me })).data;
  assert.deepEqual([d0.coverMode, d0.coverBgUrl, d0.coverColor], ["text", null, null], "預設是文字封面");

  // 文字可疊在圖片上（業主 2026-11-22）：預設顯示清單名稱，可自訂、可關閉，文字設定獨立於封面類型。
  assert.equal(((await call<{ coverText: string | null }>("GET", `/my-lists/${id}`, { token: me })).data).coverText, "新夥伴必看", "預設文字＝清單名稱");
  const ct = (await call<{ coverText: string | null; coverTextRaw: string }>("PATCH", `/my-lists/${id}`, { token: me, body: { coverText: "  歡迎加入！ " } })).data;
  assert.deepEqual([ct.coverText, ct.coverTextRaw], ["歡迎加入！", "歡迎加入！"], "自訂文字會去掉空白");
  await call("PATCH", `/my-lists/${id}`, { token: me, body: { coverText: "" } });

  // 單色底色：只能選色票裡的顏色（業主 2026-11-22）。
  assert.equal((await call("PATCH", `/my-lists/${id}`, { token: me, body: { coverColor: "#123456" } })).status, 400, "不在色票裡的顏色不行");
  const colored = (await call<{ coverColor: string | null }>("PATCH", `/my-lists/${id}`, { token: me, body: { coverColor: "#1f4e79" } })).data;
  assert.equal(colored.coverColor, "#1F4E79", "選色票的顏色（不分大小寫）");
  assert.equal((await call("PUT", `/my-lists/${id}/cover-image`, { token: me, body: "x" })).status, 404, "上傳封面圖的功能已移除");
  await call("PATCH", `/my-lists/${id}`, { token: me, body: { coverColor: "" } });

  assert.equal((await call("PATCH", `/my-lists/${id}`, { token: me, body: { coverMode: "upload" } })).status, 400, "會員不能選上傳封面（已取消上傳）");
  assert.equal((await call("PATCH", `/my-lists/${id}`, { token: me, body: { coverMode: "bad" } })).status, 400);
  assert.equal((await call("PATCH", `/my-lists/${id}`, { token: me, body: { coverBgId: "gnope" } })).status, 404, "底圖要存在");

  const t = await call<{ coverMode: string; coverBgUrl: string | null; coverUrl: string | null }>("PATCH", `/my-lists/${id}`, { token: me, body: { coverMode: "text", coverBgId: "gtest123" } });
  assert.equal(t.status, 200);
  assert.equal(t.data.coverMode, "text");
  assert.match(t.data.coverBgUrl ?? "", /listbg%2Fgtest123/);
  assert.equal(t.data.coverUrl, null, "文字封面沒有圖片網址");
  const mine = (await call<{ lists: { coverMode: string; coverBgUrl: string | null }[] }>("GET", "/my-lists", { token: me })).data.lists[0]!;
  assert.equal(mine.coverMode, "text");

  assert.equal((await call<{ id: string }[]>("GET", "/list-cover-bgs", { token: me })).data.length, 1, "會員可看到底圖清單");
  assert.equal((await call("GET", "/admin/list-cover-bgs", { token: me })).status, 403, "管理清單只有超級管理員");
  const adm = (await call<{ id: string; used: number }[]>("GET", "/admin/list-cover-bgs", { token: admin })).data;
  assert.equal(adm[0]!.used, 1, "有 1 份清單的文字封面在用");
  assert.equal((await call("PATCH", "/admin/list-cover-bgs/gtest123", { token: admin, body: { name: "新名稱" } })).status, 200);
  assert.equal((await call("DELETE", "/admin/list-cover-bgs/gtest123", { token: admin })).status, 200);
  const after = (await call<{ coverMode: string; coverBgUrl: string | null }>("GET", `/my-lists/${id}`, { token: me })).data;
  assert.deepEqual([after.coverMode, after.coverBgUrl], ["text", null], "底圖刪除後改回純色，仍是文字封面");
});
