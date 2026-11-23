import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("使用統計：匿名回報、格式不對略過、管理員交叉查詢（裝置×系統、時段、卡片）", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const [admin, student] = await Promise.all([login("demo-admin"), login("demo-student")]);
  const send = (b: unknown) => call("POST", "/usage", { body: b });
  await send({ kind: "visit", device: "mobile", os: "ios" });
  await send({ kind: "visit", device: "mobile", os: "ios" });
  await send({ kind: "visit", device: "mobile", os: "android" });
  await send({ kind: "visit", device: "desktop", os: "other" });
  await send({ kind: "card_series", device: "mobile", os: "ios", target: "安麗官方素材" });
  await send({ kind: "card_series", device: "mobile", os: "ios" }); // 沒有 target：略過
  await send({ kind: "visit", device: "watch", os: "ios" }); // 不合格：略過

  assert.equal((await call("GET", "/admin/usage", { token: student })).status, 403, "一般學員不能看");
  assert.equal((await call("GET", "/admin/usage")).status, 401);
  type T = { rows: { label: string; cells: number[]; total: number }[]; cols: string[]; total: number };
  const q = async (qs: string) => (await call<T>("GET", `/admin/usage?${qs}`, { token: admin })).data;
  const dev = await q("kinds=visit&rows=device");
  assert.deepEqual(dev.rows.map((r) => [r.label, r.total]), [["手機", 3], ["電腦", 1]]);
  const cross = await q("kinds=visit&rows=device&cols=os");
  assert.deepEqual(cross.cols, ["iOS", "Android", "其他（電腦等）"]);
  assert.deepEqual(cross.rows.map((r) => r.cells), [[2, 1, 0], [0, 0, 1]], "裝置 × 系統");
  const onlyIos = await q("kinds=visit&rows=device&os=ios");
  assert.equal(onlyIos.total, 2, "篩選：只看 iOS");
  const cards = await q("kinds=card_series&rows=item");
  assert.deepEqual(cards.rows.map((r) => [r.label, r.total]), [["系列｜安麗官方素材", 1]]);
  const hour = await q("kinds=visit&rows=slot");
  assert.equal(hour.total, 4);

  // 管理員本人的操作預設不列入（2026-11-23）：管理員帳號、帶 owner=1 的裝置、管理員用過的網路。
  const base = (await q("kinds=visit&rows=device")).total;
  const withIp = (ip: string, token: string | undefined, body: unknown) =>
    handleApi(new Request("https://learn.test/api/v2/usage", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }), env);
  const visit = { kind: "visit", device: "desktop", os: "other" };
  await withIp("1.2.3.4", admin, visit); // 管理員登入：不算，並記下這個網路
  await withIp("9.9.9.9", undefined, { ...visit, owner: 1 }); // 本人的裝置記號：不算
  await withIp("1.2.3.4", undefined, visit); // 同網路、未登入／無痕：不算
  await withIp("1.2.3.4", student, visit); // 同網路、測試會員：不算
  await withIp("5.6.7.8", undefined, visit); // 別的網路：算
  assert.equal((await q("kinds=visit&rows=device")).total, base + 1, "預設只多算別的網路那一筆");
  assert.equal((await q("kinds=visit&rows=device&admin=1")).total, base + 5, "勾「包含管理員操作」才全算");
});
