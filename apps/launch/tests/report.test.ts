import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail, Order, RegistrationReport } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("報名與營收報表：依中心／課程／月份加總、只算已開通的繳費金額、範圍同審核權限、可匯出 CSV", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const raw = (method: string, path: string, token?: string, body?: unknown) => handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const call = async <T = Record<string, unknown>,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await raw(method, path, token, body);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub })).data.token;
  const [admin, pres, taipei, taichung] = await Promise.all(["demo-admin", "demo-president", "demo-student", "demo-silver"].map(login));
  const paid = (await call<CourseDetail>("POST", "/admin/courses", admin, { title: "付費課", teacher: "王", priceTwd: 800, status: "published" })).data;
  const free = (await call<CourseDetail>("POST", "/admin/courses", admin, { title: "免費課", teacher: "王", priceTwd: 0, status: "published" })).data;
  const [o1] = (await call<Order[]>("POST", "/orders", taipei, { courseIds: [paid.id] })).data;
  await call<Order[]>("POST", "/orders", taichung, { courseIds: [paid.id] });
  await call<Order[]>("POST", "/orders", taipei, { courseIds: [free.id] });
  // 審核開通台北那一筆（實收 800）
  const done = await call("POST", `/admin/orders/${o1!.id}/review`, admin, { action: "paid", paidTwd: 800 });
  assert.ok(done.status === 200, `開通失敗：${JSON.stringify(done.data)}`);

  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const q = `?from=${today}&to=${today}`;
  const byCenter = (await call<RegistrationReport>("GET", `/admin/reports/registrations${q}`, admin)).data;
  assert.equal(byCenter.total.registrations, 3);
  assert.equal(byCenter.total.opened, 2, "付費開通 1＋免費 1");
  assert.equal(byCenter.total.pending, 1);
  assert.equal(byCenter.total.free, 1);
  assert.equal(byCenter.total.amountTwd, 800, "只算已開通的付費報名");
  const tp = byCenter.rows.find((r) => r.label === "台北中心")!;
  assert.deepEqual([tp.registrations, tp.amountTwd], [2, 800]);
  const byCourse = (await call<RegistrationReport>("GET", `/admin/reports/registrations${q}&by=course`, admin)).data;
  assert.deepEqual(byCourse.rows.map((r) => [r.label, r.registrations]), [["付費課", 2], ["免費課", 1]]);
  const byMonth = (await call<RegistrationReport>("GET", `/admin/reports/registrations${q}&by=month`, admin)).data;
  assert.equal(byMonth.rows.length, 1);
  // 會長只看自己中心（台北）學員的報名
  const presView = (await call<RegistrationReport>("GET", `/admin/reports/registrations${q}`, pres)).data;
  assert.deepEqual(presView.rows.map((r) => r.label), ["台北中心"]);
  assert.equal((await call("GET", `/admin/reports/registrations${q}`, taipei)).status, 403, "一般學員不能看");
  // 期間外沒有資料
  assert.equal((await call<RegistrationReport>("GET", "/admin/reports/registrations?from=2020-01-01&to=2020-01-31", admin)).data.total.registrations, 0);
  assert.equal((await call("GET", `/admin/reports/registrations?from=${today}&to=2020-01-01`, admin)).status, 400);
  const csv = await raw("GET", `/admin/reports/registrations.csv${q}`, admin);
  assert.equal(csv.status, 200);
  const text = await csv.text();
  assert.match(text, /中心,報名數,已開通,待審核/);
  assert.match(text, /合計,3,2,1,0,1,800/);
});
