import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateAchievements } from "../src/achievements.ts";
import { drawZoneVideoBadges } from "../src/zone-video-badges.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("素材影片徽章：每個區塊挑 1 支（多於 5 支挑 2 支）、可重複抽、讀完才解鎖", async () => {
  const db = createTestDb();
  await db.prepare("DELETE FROM achievements").run();
  const course = (id: string, zone: string, scope = "all") => db.prepare("INSERT INTO courses (id, title, status, is_list, zone, view_scope) VALUES (?, ?, 'published', 1, ?, ?)").bind(id, id, zone, scope).run();
  await course("m1", "amway_material");
  await course("b1", "amway_brand");
  await course("h1", "hglobal"); // 寰宇專區不抽
  await course("p1", "amway_material", "link_guest"); // 私密連結不抽
  let pos = 0;
  const lesson = (cid: string, id: string, kind: string, yt = true) => db.prepare("INSERT INTO lessons (id, course_id, position, title, kind, media_type, media_ref) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, cid, pos++, id, kind, kind === "material" ? (yt ? "youtube" : "demo") : "demo", kind === "material" && yt ? "vid" : null).run();
  await lesson("m1", "s-a", "section");
  for (let i = 0; i < 6; i++) await lesson("m1", `a${i}`, "material"); // 6 支 → 抽 2
  await lesson("m1", "s-b", "section");
  for (let i = 0; i < 3; i++) await lesson("m1", `b${i}`, "material"); // 3 支 → 抽 1
  await lesson("m1", "x-link", "material", false); // 非影片
  await lesson("b1", "q0", "material"); // 沒有區塊的清單當一組 → 1
  await lesson("h1", "h0", "material");
  await lesson("p1", "p0", "material");

  const r = await drawZoneVideoBadges(db);
  assert.deepEqual([r.added, r.total, r.groups], [4, 4, 3]);
  const again = await drawZoneVideoBadges(db);
  assert.equal(again.added, 0);
  const rows = (await db.prepare("SELECT lesson_id, icon FROM achievements WHERE condition_type = 'material_video'").all<{ lesson_id: string; icon: string }>()).results;
  assert.ok(rows.every((x) => x.icon === "@amway" && !["h0", "p0", "x-link"].includes(x.lesson_id)));
  assert.equal(rows.filter((x) => x.lesson_id.startsWith("a")).length, 2);

  const target = rows.find((x) => x.lesson_id === "q0")!.lesson_id;
  assert.equal((await evaluateAchievements(db, "m1x")).list.some((a) => a.earned), false);
  await db.prepare("INSERT INTO lesson_progress (member_sub, lesson_id, course_id) VALUES ('m1x', ?, 'b1')").bind(target).run();
  const { list, fresh } = await evaluateAchievements(db, "m1x");
  assert.equal(fresh.length, 1);
  assert.equal(list.filter((a) => a.earned).length, 1);
  assert.equal(list.find((a) => a.earned)?.lessonTitle, "q0");
});
