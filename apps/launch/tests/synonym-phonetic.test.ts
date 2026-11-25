import assert from "node:assert/strict";
import { test } from "node:test";
import { phoneticSearch, resetPhoneticCache, resetSynonymCache } from "../src/phonetic-search.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("同音搜尋：打錯字「和本翠」＝關聯詞「漢本萃」，找到同組「智慧草本」的課程", async () => {
  resetPhoneticCache();
  resetSynonymCache();
  const db = createTestDb();
  await db.prepare("INSERT INTO courses (id, title, is_list, status, series, view_scope, is_public, min_rank_code) VALUES ('c1', '紐崔萊智慧草本系列', 0, 'published', '', 'all', 1, 'none'), ('c2', '無關的課', 0, 'published', '', 'all', 1, 'none')").run();
  await db.prepare("INSERT INTO search_synonyms (terms) VALUES (?)").bind(JSON.stringify(["智慧草本", "中藥", "草藥", "漢本萃"])).run();
  const r = await phoneticSearch(db, "和本翠");
  assert.deepEqual(r.courses, ["c1"]);
  resetSynonymCache();
  assert.deepEqual((await phoneticSearch(db, "和本翠")).courses.includes("c2"), false);
  await db.prepare("INSERT INTO courses (id, title, is_list, status, series, view_scope, is_public, min_rank_code) VALUES ('c3', '重要性說明', 0, 'published', '', 'all', 1, 'none')").run();
  resetPhoneticCache();
  const r2 = (await phoneticSearch(db, "和本翠")).courses;
  assert.ok(r2.indexOf("c3") > r2.indexOf("c1"), "2 字的「中藥」同音「重要」找到的排在最後面");
});
