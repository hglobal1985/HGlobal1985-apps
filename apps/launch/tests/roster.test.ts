import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import { lookupUplines, setCentralFetch } from "../src/central.ts";
import type { CourseDetail, Order, Roster } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("報名名單：管理者與審核人員可看、學員不行；篩選、移除資格（通知學員）、匯出 CSV；中央沒回應時上手顯示未提供", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown; raw?: boolean } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }), env);
    return { status: res.status, data: (opts.raw ? await res.text() : await res.json()) as T };
  };
  const tok = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const admin = await tok("demo-admin");
  const a = await tok("demo-student");
  const b = await tok("demo-silver");
  const out = await tok("demo-outsider");
  const c = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "名單課", teacher: "王", status: "published", priceTwd: 0 } })).data;
  await call("PATCH", `/admin/courses/${c.id}`, { token: admin, body: { inviteOnly: true, inviteCode: "8888" } });
  const [joined] = (await call<Order[]>("POST", "/orders", { token: a, body: { courseIds: [c.id], inviteCode: "8888" } })).data;
  await call("POST", "/orders", { token: b, body: { courseIds: [c.id] } }); // 無邀請碼＝待審核

  assert.equal((await call("GET", `/admin/courses/${c.id}/roster`, { token: out })).status, 403, "一般學員不能看名單");
  const r = (await call<Roster>("GET", `/admin/courses/${c.id}/roster`, { token: admin })).data;
  assert.equal(r.total, 2);
  assert.deepEqual(r.counts, { all: 2, pending: 1, invite: 1, opened: 1 });
  assert.deepEqual(r.rows.map((x) => x.method).sort(), ["invite", "invite_request"]);
  assert.equal(r.uplineAvailable, false, "沒有中央服務金鑰＝上手顯示未提供");
  assert.ok(r.rows.every((x) => x.uplinePlatinum === null && x.uplineDiamond === null));
  const detail = (await call<CourseDetail>("GET", `/courses/${c.id}`, { token: admin })).data;
  assert.equal(detail.canRoster, true);
  assert.equal(((await call<CourseDetail>("GET", `/courses/${c.id}`, { token: out })).data).canRoster, false);

  const pending = (await call<Roster>("GET", `/admin/courses/${c.id}/roster?filter=pending`, { token: admin })).data;
  assert.equal(pending.rows.length, 1);
  assert.equal(pending.rows[0].method, "invite_request");
  const search = (await call<Roster>("GET", `/admin/courses/${c.id}/roster?q=${encodeURIComponent("銀章")}`, { token: admin })).data;
  assert.equal(search.rows.length, 1);

  const csv = (await call<string>("GET", `/admin/courses/${c.id}/roster.csv`, { token: admin, raw: true })).data;
  assert.match(csv, /姓名,中心,報名方式,狀態,報名時間,上手白金,上手鑽石/);
  assert.match(csv, /邀請碼加入/);
  assert.match(csv, /未提供/);

  // 移除資格：取消開通＋通知學員
  assert.equal((await call("DELETE", `/admin/courses/${c.id}/roster/${joined.id}`, { token: admin })).status, 200);
  const after = (await call<Roster>("GET", `/admin/courses/${c.id}/roster`, { token: admin })).data;
  assert.equal(after.rows.find((x) => x.orderId === joined.id)?.status, "rejected");
  assert.equal(((await call<CourseDetail>("GET", `/courses/${c.id}`, { token: a })).data).enrollment, null);
  assert.ok((await call<{ title: string }[]>("GET", "/notifications", { token: a })).data.some((n) => n.title === "報名資格已被移除"));
  assert.equal((await call("DELETE", `/admin/courses/${c.id}/roster/${joined.id}`, { token: admin })).status, 409, "已移除不能再移除");
});

test("上手白金／鑽石：一次最多 100 筆、依中央格式讀取、10 分鐘記憶體快取；失敗不快取、不拋錯", async () => {
  const calls: { ids: string[]; fields: string[]; use: string }[] = [];
  let mode: "ok" | "429" = "ok";
  setCentralFetch(async (url, init) => {
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.endsWith("/v1/service/token")) return ok({ access_token: "svc", expires_in: 300 });
    if (url.endsWith("/v1/apps/learn/members/lookup")) {
      const body = JSON.parse(String(init?.body)) as { member_ids: string[]; fields: string[]; use: string };
      calls.push({ ids: body.member_ids, fields: body.fields, use: body.use });
      if (mode === "429") return new Response("{}", { status: 429 });
      return ok({ members: body.member_ids.filter((x) => x !== "gone").map((id) => ({ member_id: id, fields: { upline_platinum: `白金-${id}`, upline_diamond: id === "empty" ? null : `鑽石-${id}` } })), not_found: body.member_ids.filter((x) => x === "gone") });
    }
    return new Response("{}", { status: 404 });
  });
  const ids = Array.from({ length: 230 }, (_, i) => `m${i}`);
  const got = await lookupUplines("secret", [...ids, "empty", "gone"]);
  assert.ok(got);
  assert.deepEqual(calls.map((c) => c.ids.length), [100, 100, 32], "一次最多 100 個");
  assert.deepEqual(calls[0].fields, ["upline_platinum", "upline_diamond"]);
  assert.equal(calls[0].use, "display");
  assert.deepEqual(got!.get("m5"), { platinum: "白金-m5", diamond: "鑽石-m5" });
  assert.deepEqual(got!.get("empty"), { platinum: "白金-empty", diamond: null }, "沒填＝null");
  assert.deepEqual(got!.get("gone"), { platinum: null, diamond: null }, "查不到＝沒資料");
  // 再讀一次：全部來自快取，不再呼叫中央
  await lookupUplines("secret", ["m1", "m2"]);
  assert.equal(calls.length, 3);
  // 失敗（429）：回 undefined（畫面顯示未提供），而且不快取
  mode = "429";
  assert.equal(await lookupUplines("secret", ["fresh1"]), undefined);
  mode = "ok";
  assert.equal((await lookupUplines("secret", ["fresh1"]))?.get("fresh1")?.platinum, "白金-fresh1");
});

test("上手資料：中央說某個會員編號格式不合（422 member_ids.N）就剔除那一筆、其餘重送，不害整批拿不到", async () => {
  const sent: string[][] = [];
  setCentralFetch(async (url, init) => {
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.endsWith("/v1/service/token")) return ok({ access_token: "svc2", expires_in: 300 });
    if (url.endsWith("/v1/apps/learn/members/lookup")) {
      const ids = (JSON.parse(String(init?.body)) as { member_ids: string[] }).member_ids;
      sent.push(ids);
      const bad = ids.findIndex((x) => x.startsWith("bad"));
      if (bad >= 0) return new Response(JSON.stringify({ error: { code: "invalid_field", message: "Invalid request", details: { field_key: `member_ids.${bad}`, reason: "invalid_string" } } }), { status: 422 });
      return ok({ members: ids.map((id) => ({ member_id: id, fields: { upline_platinum: `白-${id}`, upline_diamond: null } })), not_found: [] });
    }
    return new Response("{}", { status: 404 });
  });
  const got = await lookupUplines("secret", ["u1", "u2", "bad-a", "u3", "bad-b"]);
  assert.ok(got, "有剔除壞編號後仍成功");
  assert.deepEqual(got!.get("u3"), { platinum: "白-u3", diamond: null });
  assert.deepEqual(got!.get("bad-a"), { platinum: null, diamond: null });
  assert.deepEqual(got!.get("bad-b"), { platinum: null, diamond: null });
  assert.equal(sent.length, 3, "第一次送 5 筆、剔除一筆重送、再剔除一筆重送");
  assert.deepEqual(sent[2], ["u1", "u2", "u3"]);
});
