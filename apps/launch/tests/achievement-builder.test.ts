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
  assert.equal(achRecipeOf("course_completed"), null);
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
