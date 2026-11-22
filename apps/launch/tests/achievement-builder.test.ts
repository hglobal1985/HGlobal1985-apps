import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateAchievements } from "../src/achievements.ts";
import { ACH_VERBS, ACHIEVEMENT_TYPES, achRecipeOf, achTypeOf, type AchTime } from "../src/contract.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("成就產生器：每個動詞＋對象＋時段都能算出條件類型，且能反查回來", () => {
  for (let vi = 0; vi < ACH_VERBS.length; vi += 1) {
    ACH_VERBS[vi]!.objects.forEach((o, oi) => {
      const times = (o.times ? (Object.keys(o.times) as AchTime[]) : (["any"] as AchTime[]));
      for (const time of times) {
        const type = achTypeOf(vi, oi, time);
        assert.ok(type && ACHIEVEMENT_TYPES[type], `${ACH_VERBS[vi]!.verb}${o.name}`);
        const back = achRecipeOf(type, o.feature ?? (o.pickFeature ? "search" : null));
        assert.deepEqual(back, { vi, oi, time }, `${ACH_VERBS[vi]!.verb}${o.name}/${time}`);
      }
    });
  }
  // 沒有動詞對應的舊類型：反查回 null
  assert.equal(achRecipeOf("material_video"), null);
});

test("下載教材檔案：同一個檔案下載多次只算一次；單位可自選並回傳", async () => {
  const db = createTestDb();
  await db.prepare("DELETE FROM achievements").run();
  await db.prepare("INSERT INTO achievements (id, name, condition_type, threshold, unit) VALUES ('d2', '下載兩個', 'files_downloaded', 2, '個')").run();
  for (const [id, att] of [["x1", "a1"], ["x2", "a1"], ["x3", "a2"]]) {
    await db.prepare("INSERT INTO material_downloads (id, att_id, course_id, member_sub, name) VALUES (?, ?, 'c', 'm1', 'f')").bind(id, att).run();
  }
  const { list } = await evaluateAchievements(db, "m1");
  assert.equal(list[0]!.current, 2);
  assert.equal(list[0]!.earned, true);
  assert.equal(list[0]!.unit, "個");
});

test("指定學習：指定教材、課程卡、系列卡都能達成；搜尋端點與建立檢查", async () => {
  const db = createTestDb();
  await db.prepare("DELETE FROM achievements").run();
  for (const [id, series] of [["c1", "S1"], ["c2", "S1"], ["c3", "S1"]]) await db.prepare("INSERT INTO courses (id, title, series, status) VALUES (?, ?, ?, 'published')").bind(id, `課程${id}`, series).run();
  for (const [lid, cid] of [["l1", "c1"], ["l2", "c2"]]) {
    await db.prepare("INSERT INTO lessons (id, course_id, position, title, kind) VALUES (?, ?, 0, ?, 'chapter')").bind(lid, cid, `章${lid}`).run();
    await db.prepare("INSERT INTO lesson_progress (member_sub, lesson_id, course_id) VALUES ('m1', ?, ?)").bind(lid, cid).run();
  }
  await db.prepare("INSERT INTO achievements (id, name, condition_type, threshold, lesson_id) VALUES ('t1', 't1', 'target_lesson', 1, 'l1')").run();
  await db.prepare("INSERT INTO achievements (id, name, condition_type, threshold, course_id) VALUES ('t2', 't2', 'course_completed', 1, 'c2')").run();
  await db.prepare("INSERT INTO achievements (id, name, condition_type, threshold, series) VALUES ('t3', 't3', 'series_completed', 2, 'S1')").run();
  await db.prepare("INSERT INTO achievements (id, name, condition_type, threshold, series) VALUES ('t4', 't4', 'series_completed', 3, 'S1')").run();
  const { list } = await evaluateAchievements(db, "m1");
  const g = Object.fromEntries(list.map((a) => [a.id, [a.earned, a.current]]));
  assert.deepEqual(g.t1, [true, 1]);
  assert.deepEqual(g.t2, [true, 1]);
  assert.deepEqual(g.t3, [true, 2]);
  assert.deepEqual(g.t4, [false, 2]);

  const { handleApi } = await import("../src/api.ts");
  const env = { DB: db, DEMO_LOGIN: "on" } as never;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as unknown };
  };
  const admin = ((await call("POST", "/auth/demo", { sub: "demo-admin" })).data as { token: string }).token;
  const found = await call("GET", "/admin/achievement-targets?kind=lesson&q=l2", undefined, admin);
  assert.equal(found.status, 200);
  {
    assert.equal((found.data as { id: string }[])[0]?.id, "l2");
    assert.equal(((await call("GET", "/admin/achievement-targets?kind=series&q=S", undefined, admin)).data as { id: string }[])[0]?.id, "S1");
    assert.equal((await call("POST", "/admin/achievements", { name: "x", type: "target_lesson", threshold: 1 }, admin)).status, 400);
    assert.equal((await call("POST", "/admin/achievements", { name: "x", type: "series_completed", threshold: 2, series: "S1" }, admin)).status, 200);
  }
});
