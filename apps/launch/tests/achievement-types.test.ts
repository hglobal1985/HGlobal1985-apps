import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateAchievements } from "../src/achievements.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("新徽章條件：連續天數、早晨／夜間／週末、單日最多、訂閱數、不同分類", async () => {
  const db = createTestDb();
  await db.prepare("DELETE FROM achievements").run();
  const types: [string, number][] = [["streak_days", 3], ["early_lessons", 1], ["night_lessons", 1], ["weekend_lessons", 1], ["lessons_in_a_day", 2], ["centers_subscribed", 1], ["series_subscribed", 1], ["categories_explored", 2], ["watch_minutes", 20]];
  for (const [t, n] of types) await db.prepare("INSERT INTO achievements (id, name, condition_type, threshold) VALUES (?, ?, ?, ?)").bind(`a-${t}`, t, t, n).run();
  for (const [id, cat] of [["c1", "營養"], ["c2", "事業"]]) await db.prepare("INSERT INTO courses (id, title, category, status) VALUES (?, ?, ?, 'published')").bind(id, id, cat).run();
  // 台灣時間：11/14（六）06:30、11/15（日）23:30、11/16（一）10:00、11/16 10:05 → 連續 3 天、單日 2 堂
  const stamps = ["2026-11-13T22:30:00Z", "2026-11-15T15:30:00Z", "2026-11-16T02:00:00Z", "2026-11-16T02:05:00Z"];
  for (let i = 0; i < stamps.length; i += 1) {
    const cid = i < 2 ? "c1" : "c2";
    await db.prepare("INSERT INTO lessons (id, course_id, position, title, kind, duration_minutes) VALUES (?, ?, ?, ?, 'chapter', 6)").bind(`l${i}`, cid, i, `l${i}`).run();
    await db.prepare("INSERT INTO lesson_progress (member_sub, lesson_id, course_id, completed_at) VALUES ('m1', ?, ?, ?)").bind(`l${i}`, cid, stamps[i]).run();
  }
  await db.prepare("INSERT INTO center_subscriptions (member_sub, center_key) VALUES ('m1', '新竹'), ('m1', 'series:美力之星')").run();
  const { list } = await evaluateAchievements(db, "m1");
  const got = Object.fromEntries(list.map((a) => [a.type, [a.earned, a.current]]));
  assert.deepEqual(got.streak_days, [true, 3]);
  assert.equal(got.early_lessons![0], true);
  assert.equal(got.night_lessons![0], true);
  assert.equal(got.weekend_lessons![0], true);
  assert.equal(got.lessons_in_a_day![0], true);
  assert.equal(got.centers_subscribed![0], true);
  assert.equal(got.series_subscribed![0], true);
  assert.equal(got.categories_explored![0], true);
  assert.equal(got.watch_minutes![0], true);
});
