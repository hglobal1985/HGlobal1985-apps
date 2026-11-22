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
});
