import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

test("migration 0052：原本自動顯示完整版的課程轉成真實一列（排在最後、關閉顯示的課程不轉）", () => {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir).filter((x) => x.endsWith(".sql")).sort();
  for (const f of files.filter((x) => x < "0052")) db.exec(readFileSync(new URL(f, dir), "utf8"));
  const course = (id: string, showFull: number) => db.prepare("INSERT INTO courses (id, title, show_full) VALUES (?, ?, ?)").run(id, id, showFull);
  const lesson = (id: string, c: string, pos: number, ref: string | null, start: number | null, end: number | null) =>
    db.prepare("INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type, media_ref, start_seconds, end_seconds) VALUES (?, ?, ?, ?, 10, ?, ?, ?, ?)").run(id, c, pos, id, ref ? "youtube" : "demo", ref, start, end);
  course("a", 1);
  lesson("a1", "a", 1, "vid", 0, 600);
  lesson("a2", "a", 2, "vid", 600, 1200);
  course("b", 0); // 關閉顯示的不轉
  lesson("b1", "b", 1, "vid", 0, 600);
  course("c", 1); // 沒有裁切的不轉
  lesson("c1", "c", 1, "vid", null, null);
  db.exec(readFileSync(new URL("0052_full_version.sql", dir), "utf8"));
  const rows = db.prepare("SELECT course_id, position, title, duration_minutes, media_ref, kind, is_full FROM lessons WHERE is_full = 1").all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ course_id: "a", position: 3, title: "完整版課程影片", duration_minutes: 20, media_ref: "vid", kind: "material", is_full: 1 }]);
});
