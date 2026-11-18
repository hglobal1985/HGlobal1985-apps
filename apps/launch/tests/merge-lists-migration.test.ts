import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

test("0079：清單合併成區塊（教材照順序搬進區塊、舊清單刪除、系列改名、品牌帶過去）", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir).filter((x) => x.endsWith(".sql")).sort();
  const merge = files.find((f) => f.startsWith("0079"))!;
  for (const f of files.filter((x) => x < merge)) db.exec(readFileSync(new URL(f, dir), "utf8"));
  const mk = (id: string, title: string, series: string, order: number) => db.prepare("INSERT INTO courses (id, title, is_list, status, series, series_order, category) VALUES (?, ?, 1, 'published', ?, ?, '品牌:x')").run(id, title, series, order);
  const item = (course: string, pos: number, title: string, kind = "material") => db.prepare("INSERT INTO lessons (id, course_id, position, title, kind, media_type, media_ref) VALUES (?, ?, ?, ?, ?, 'youtube', 'abc')").run(`${course}-${pos}`, course, pos, title, kind);
  mk("cxnfbadr", "紐崔萊 Nutrilite", "新品上市培訓", 1);
  mk("cg62efp8", "紐崔萊", "安麗特惠直播", 0);
  mk("cnkku4e7", "雅姿 Artistry", "新品上市培訓", 2);
  mk("cndh7man", "個人護理 g&h", "新品上市培訓", 7);
  mk("cother", "別的清單", "別的系列", 0);
  item("cxnfbadr", 1, "新1");
  item("cxnfbadr", 2, "新2");
  item("cg62efp8", 1, "特1");
  item("cnkku4e7", 1, "雅1");
  item("cndh7man", 1, "護1");
  item("cndh7man", 2, "短影音", "section");
  item("cndh7man", 3, "護2");
  item("cother", 1, "不動");
  db.exec("INSERT INTO series_art (series, edm_key) VALUES ('新品上市培訓', 'k1'), ('安麗特惠直播', 'k2')");
  db.exec("INSERT INTO page_views (kind, key, total) VALUES ('series', '新品上市培訓', 82), ('series', '安麗特惠直播', 32)");
  db.exec(readFileSync(new URL(merge, dir), "utf8"));
  const q = (sql: string) => db.prepare(sql).all() as Record<string, unknown>[];
  const rows = q("SELECT position, kind, title, brand_id FROM lessons WHERE course_id = 'cxnfbadr' ORDER BY position");
  assert.deepEqual(
    rows.map((r) => `${r.position}:${r.kind}:${r.title}`),
    ["1:section:紐崔萊 Nutrilite", "2:material:新1", "3:material:新2", "4:material:特1", "5:section:雅姿 Artistry", "6:material:雅1", "7:section:個人護理 g&h", "8:material:護1", "9:material:護2"],
  );
  assert.equal(rows[0]!.brand_id, "bd884u6q");
  assert.deepEqual(q("SELECT id FROM courses WHERE is_list = 1 ORDER BY id").map((r) => r.id), ["cother", "cxnfbadr"]);
  const t = q("SELECT title, series, category FROM courses WHERE id = 'cxnfbadr'")[0]!;
  assert.deepEqual([t.title, t.series, t.category], ["安麗新品與特惠直播培訓", "安麗新品與特惠直播培訓", ""]);
  assert.deepEqual(q("SELECT series FROM series_art").map((r) => r.series), ["安麗新品與特惠直播培訓"]);
  assert.deepEqual(q("SELECT key, total FROM page_views").map((r) => [r.key, r.total]), [["安麗新品與特惠直播培訓", 114]]);
  assert.equal(q("SELECT COUNT(*) AS n FROM lessons WHERE course_id = 'cother'")[0]!.n, 1);
});
