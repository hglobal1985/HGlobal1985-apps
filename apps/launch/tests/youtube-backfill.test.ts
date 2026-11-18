import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { backfillYoutube, isoSeconds, taipeiDay } from "../src/youtube.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("YouTube 時間換算：ISO 長度與台灣日期", () => {
  assert.equal(isoSeconds("PT1H2M3S"), 3723);
  assert.equal(isoSeconds("PT45S"), 45);
  assert.equal(isoSeconds("P0D"), null);
  assert.equal(taipeiDay("2024-03-24T17:00:00Z"), "2024-03-25"); // UTC 17:00 ＝ 台灣隔天 01:00
});

test("排程補齊：教材日期空白就填發布日期、0 分鐘就填長度；已有日期不動；只查一次；沒金鑰什麼都不做", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const admin = (await call<{ token: string }>("POST", "/auth/demo", { body: { sub: "demo-admin" } })).data.token;
  const c = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { isList: true, title: "清單" } })).data;
  await call("POST", `/admin/courses/${c.id}/materials`, { token: admin, body: { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", title: "A" } });
  await call("POST", `/admin/courses/${c.id}/materials`, { token: admin, body: { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", title: "B", eventDate: "2020-01-01" } });
  const fake: typeof fetch = async (url) => {
    const ids = new URL(String(url)).searchParams.get("id")!.split(",");
    return new Response(JSON.stringify({ items: ids.map((id) => ({ id, snippet: { publishedAt: "2024-03-24T17:00:00Z", title: id }, contentDetails: { duration: "PT10M30S" } })) }), { status: 200 });
  };
  assert.deepEqual(await backfillYoutube(env, 50, fake), { checked: 0, updated: 0 }, "沒金鑰不動作");
  env.YOUTUBE_API_KEY = "k";
  const r = await backfillYoutube(env, 50, fake);
  assert.equal(r.checked, 2);
  const rows = (await db.prepare("SELECT title, event_date, duration_minutes FROM lessons WHERE course_id = ? AND kind = 'material' ORDER BY position").bind(c.id).all<{ title: string; event_date: string | null; duration_minutes: number }>()).results;
  assert.deepEqual(rows.map((x) => [x.title, x.event_date, x.duration_minutes]), [["A", "2024-03-25", 11], ["B", "2020-01-01", 11]]);
  assert.deepEqual(await backfillYoutube(env, 50, fake), { checked: 0, updated: 0 }, "每個教材只查一次");
});
