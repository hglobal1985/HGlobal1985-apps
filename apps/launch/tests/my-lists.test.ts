import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

type Lists = { id?: string; lists: { id: string; title: string; slug: string; url: string; count: number; has?: boolean; people: number; clicks: number }[]; quota: { base: number; total: number; used: number; unlocks: { name: string; earned: boolean }[] } };

test("加入我的清單：多份清單、額度與解鎖、自訂網址、備註、點擊統計、複製、已下架顯示", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const [admin, me, other] = await Promise.all([login("demo-admin"), login("demo-student"), login("demo-silver")]);
  const course = (await env.DB.prepare("SELECT id FROM courses WHERE status = 'published' LIMIT 1").first<{ id: string }>())!.id;

  assert.equal((await call("GET", "/my-lists")).status, 401, "訪客不能用");
  const a = await call<Lists>("POST", "/my-lists", { token: me, body: { title: "新夥伴必看", kind: "course", ref: course } });
  assert.equal(a.status, 200);
  assert.deepEqual({ base: a.data.quota.base, total: a.data.quota.total, used: a.data.quota.used }, { base: 2, total: 2, used: 1 }, "一開始只能建立 2 份");
  const idA = a.data.id!;
  assert.equal(a.data.lists[0]!.has, true, "建立同時加入");
  assert.match(a.data.lists[0]!.url, /^\/[a-z0-9]+\/[a-z0-9]{6}$/, "預設網址＝會員編號／隨機名稱");

  // 同一個內容加入第二份清單；第三份建立被擋
  const b = await call<Lists>("POST", "/my-lists", { token: me, body: { title: "推薦給夥伴" } });
  const idB = b.data.id!;
  assert.equal((await call("PUT", `/my-lists/${idB}/item`, { token: me, body: { kind: "course", ref: course, on: true } })).status, 200);
  const has = await call<Lists>("GET", `/my-lists?kind=course&ref=${course}`, { token: me });
  assert.deepEqual(has.data.lists.map((l) => l.has), [true, true], "同一個內容可在多份清單");
  assert.deepEqual((await call<{ marks: Record<string, number> }>("GET", "/my-lists/marks", { token: me })).data.marks, { [`course:${course}`]: 2 }, "標記：這個內容在 2 份清單裡");
  const third = await call<{ error: { code: string } }>("POST", "/my-lists", { token: me, body: { title: "第三份" } });
  assert.equal(third.status, 403);
  assert.equal(third.data.error.code, "list_quota");

  // 解鎖：完成指定成就多一份
  const ach = (await env.DB.prepare("SELECT id FROM achievements LIMIT 1").first<{ id: string }>())!.id;
  const saved = await call("PUT", "/admin/ui-config", { token: admin, body: { app: { listUnlocks: [{ achievementId: ach, extra: 3 }] } } });
  assert.equal(saved.status, 200);
  let q = (await call<Lists>("GET", "/my-lists", { token: me })).data.quota;
  assert.equal(q.total, 2);
  assert.equal(q.unlocks[0]!.earned, false);
  await env.DB.prepare("INSERT INTO member_achievements (member_sub, achievement_id) VALUES ('demo-student', ?)").bind(ach).run();
  q = (await call<Lists>("GET", "/my-lists", { token: me })).data.quota;
  assert.equal(q.total, 5, "完成成就後多 3 份");
  assert.equal((await call("POST", "/my-lists", { token: me, body: { title: "第三份" } })).status, 200);

  // 自訂網址：格式、重複；不必避開系統保留字
  assert.equal((await call("PATCH", `/my-lists/${idA}`, { token: me, body: { slug: "ab" } })).status, 400);
  assert.equal((await call("PATCH", `/my-lists/${idA}`, { token: me, body: { slug: "admin" } })).status, 200, "前面有會員編號，不擋保留字");
  assert.equal((await call("PATCH", `/my-lists/${idB}`, { token: me, body: { slug: "admin" } })).status, 409, "同一個人不能重複");
  assert.equal((await call("PATCH", `/my-lists/${idA}`, { token: other, body: { title: "別人改" } })).status, 404, "不能改別人的清單");

  // 備註、封面
  const detail = (await call<{ items: { id: string; note: string; coverUrl: string | null }[] }>("GET", `/my-lists/${idA}`, { token: me })).data;
  const itemId = detail.items[0]!.id;
  const noted = await call<{ items: { note: string }[] }>("PATCH", `/my-lists/${idA}/items/${itemId}`, { token: me, body: { note: "下次小組聚會用" } });
  assert.equal(noted.data.items[0]!.note, "下次小組聚會用");
  assert.equal((await call("PATCH", `/my-lists/${idA}`, { token: me, body: { coverItemId: itemId } })).status, 200);

  // 公開檢視：訪客可看；點擊 +1、人數不重複；主人自己看不算
  const number = (await call<Lists>("GET", "/my-lists", { token: me })).data.lists[0]!.url.split("/")[1]!;
  const view = (vid: string, token?: string) => call<{ title: string; clicks: number; items: { note: string; missing: boolean }[] }>("POST", `/my-lists/view/${number}/admin`, { token, body: { vid, hint: "line" } });
  assert.equal((await view("visitor-aaaa1111")).data.clicks, 1);
  assert.equal((await view("visitor-aaaa1111")).data.clicks, 2);
  assert.equal((await view("visitor-bbbb2222")).data.clicks, 3);
  assert.equal((await view("owner-vid-000000", me)).data.clicks, 3, "主人自己看不算點擊");
  const stats = (await call<{ clicks: number; people: number; bySource: Record<string, number>; days: { n: number }[] }>("GET", `/my-lists/${idA}/stats`, { token: me })).data;
  assert.deepEqual({ clicks: stats.clicks, people: stats.people, line: stats.bySource.line, today: stats.days[0]!.n }, { clicks: 3, people: 2, line: 3, today: 3 });
  assert.equal((await call("POST", "/my-lists/view/nobody/xxxxxx", { body: { vid: "x" } })).status, 404);
  // 成效再加三項（業主 2026-11-22）：項目點開次數、分享次數、被複製次數；主人自己點、不屬於這份清單的項目不算。
  const hitItem = (await env.DB.prepare("SELECT id FROM my_list_items WHERE list_id = ?").bind(idA).first<{ id: string }>())!.id;
  const hit = (token?: string, id = hitItem) => call("POST", `/my-lists/view/${number}/admin/item/${id}/hit`, { token });
  await hit();
  await hit();
  await hit(me);
  await hit(undefined, "izzzzzzzz");
  assert.equal((await call("POST", `/my-lists/${idA}/share`, { token: me })).status, 200);
  assert.equal((await call("POST", `/my-lists/${idA}/share`, { token: other })).status, 404, "別人的清單不能記分享");
  const more = (await call<{ shares: number; copies: number; items: { id: string; n: number }[] }>("GET", `/my-lists/${idA}/stats`, { token: me })).data;
  assert.deepEqual({ shares: more.shares, copies: more.copies, hits: more.items.find((x) => x.id === hitItem)?.n }, { shares: 1, copies: 0, hits: 2 });

  // 內容下架：仍在清單裡，顯示「已下架」
  await env.DB.prepare("UPDATE courses SET status = 'archived' WHERE id = ?").bind(course).run();
  const after = (await view("visitor-cccc3333")).data;
  assert.equal(after.items[0]!.missing, true);

  // 複製別人的清單：額度夠才行；自己的不能複製
  assert.equal((await call("POST", `/my-lists/view/${number}/admin/copy`, { token: me })).status, 400);
  const copied = await call<{ id: string }>("POST", `/my-lists/view/${number}/admin/copy`, { token: other });
  assert.equal(copied.status, 200);
  assert.equal((await call<Lists>("GET", "/my-lists", { token: other })).data.lists[0]!.count, 1);
  assert.equal((await call("POST", `/my-lists/view/${number}/admin/copy`, { token: other })).status, 200, "第二份");
  const full = await call<{ error: { message: string } }>("POST", `/my-lists/view/${number}/admin/copy`, { token: other });
  assert.equal(full.status, 403);
  assert.match(full.data.error.message, /清單數量已用完/);

  // 刪除清單
  assert.equal((await call("DELETE", `/my-lists/${idB}`, { token: me })).status, 200);
  assert.equal((await call("GET", `/my-lists/${idB}`, { token: me })).status, 404);
});
