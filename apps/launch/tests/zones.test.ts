import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseSummary } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("專區：預設（課程→寰宇、清單→安麗素材）、移動鈕同系列一起搬、只有超級管理員", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const tok = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const admin = await tok("demo-admin");
  const student = await tok("demo-student");
  const mk = async (title: string, extra: Record<string, unknown>) => (await call<{ id: string }>("POST", "/admin/courses", { token: admin, body: { title, teacher: "王", status: "published", priceTwd: 0, ...extra } })).data.id;
  const a = await mk("課A", {});
  const b = await mk("清單B", { isList: true, series: "系列X" });
  const c = await mk("清單C", { isList: true, series: "系列X" });
  const zoneOfId = async (id: string) => ((await call<CourseSummary[]>("GET", "/courses", { token: admin })).data.find((x) => x.id === id))?.zone;
  assert.equal(await zoneOfId(a), "hglobal");
  assert.equal(await zoneOfId(b), "amway_material");
  assert.equal((await call("POST", "/admin/zone-move", { token: student, body: { zone: "amway_brand", ids: [b] } })).status, 403);
  assert.equal((await call("POST", "/admin/zone-move", { token: admin, body: { zone: "nope", ids: [b] } })).status, 400);
  assert.equal((await call("POST", "/admin/zone-move", { token: admin, body: { zone: "amway_brand", ids: [b] } })).status, 200);
  assert.equal(await zoneOfId(b), "amway_brand");
  assert.equal(await zoneOfId(c), "amway_brand"); // 同系列一起搬
  assert.equal(await zoneOfId(a), "hglobal");
  // 基本資料也能改專區
  await call("PATCH", `/admin/courses/${a}`, { token: admin, body: { zone: "amway_material" } });
  assert.equal(await zoneOfId(a), "amway_material");
});

test("0083：認識寰宇 4 份清單合併成「寰宇文化」，放寰宇專區", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir).filter((x) => x.endsWith(".sql")).sort();
  const m = files.find((f) => f.startsWith("0083"))!;
  for (const f of files.filter((x) => x < m)) db.exec(readFileSync(new URL(f, dir), "utf8"));
  const mk = (id: string, title: string) => db.prepare("INSERT INTO courses (id, title, is_list, status, series, category) VALUES (?, ?, 1, 'published', '認識寰宇', '')").run(id, title);
  mk("c6z2uf6f", "寰宇人才秀");
  mk("c8qzjkh8", "王老師（事業篇）");
  mk("cvjtgdfu", "王老師（生活篇）");
  mk("ccwvuttt", "寰宇大會花絮回顧");
  const item = (course: string, pos: number, title: string) => db.prepare("INSERT INTO lessons (id, course_id, position, title, kind, media_type) VALUES (?, ?, ?, ?, 'material', 'demo')").run(`${course}-${pos}`, course, pos, title);
  item("c6z2uf6f", 1, "人1");
  item("c8qzjkh8", 1, "事1");
  item("c8qzjkh8", 2, "事2");
  item("ccwvuttt", 1, "花1");
  db.exec("INSERT INTO series_art (series, edm_key) VALUES ('認識寰宇', 'k')");
  db.exec("INSERT INTO page_views (kind, key, total) VALUES ('series', '認識寰宇', 13)");
  db.exec(readFileSync(new URL(m, dir), "utf8"));
  const q = (sql: string) => db.prepare(sql).all() as Record<string, unknown>[];
  assert.deepEqual(q("SELECT kind, title FROM lessons WHERE course_id = 'c6z2uf6f' ORDER BY position").map((r) => `${r.kind}:${r.title}`), ["section:寰宇人才秀", "material:人1", "section:王老師（事業篇）", "material:事1", "material:事2", "section:王老師（生活篇）", "section:寰宇大會花絮回顧", "material:花1"]);
  assert.deepEqual(q("SELECT id, title, series, zone FROM courses WHERE series = '寰宇文化'").map((r) => [r.id, r.title, r.series, r.zone]), [["c6z2uf6f", "寰宇文化", "寰宇文化", "hglobal"]]);
  assert.deepEqual(q("SELECT series FROM series_art").map((r) => r.series), ["寰宇文化"]);
  assert.deepEqual(q("SELECT key FROM page_views").map((r) => r.key), ["寰宇文化"]);
});
