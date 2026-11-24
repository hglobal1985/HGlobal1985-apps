import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import { ensureBrandCards } from "../src/brand-cards.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { ensureTreasureLinks } from "../src/treasure-box.ts";
import { loadConfig } from "../src/ui-config.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("實戰百寶箱 ↔ 品牌館：每品牌一個區塊、品牌卡最前面連結、名稱／封面／順序雙向同步", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await run("INSERT INTO brand_logos (id, name, sort_order) VALUES ('ba', '紐崔萊', 1), ('bb', '雅姿', 2), ('bc', '益之源', 3)");
  await run("INSERT INTO courses (id, title, is_list, status, series, view_scope, is_public, zone, cover_key, art_version) VALUES ('cqqxw4z2', '實戰百寶箱', 0, 'published', '實戰百寶箱', 'all', 1, 'hglobal', 'course/box.jpg', 2)");
  await ensureBrandCards(env);
  assert.equal(await ensureTreasureLinks(env), 3);
  assert.equal(await ensureTreasureLinks(env), 0); // 可重複執行
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const admin = (await call<{ token: string }>("POST", "/auth/demo", { body: { sub: "demo-admin" } })).data.token;
  const sections = async () => (await db.prepare("SELECT title, brand_id FROM lessons WHERE course_id = 'cqqxw4z2' AND kind = 'section' ORDER BY position").all<{ title: string; brand_id: string }>()).results;
  assert.deepEqual((await sections()).map((s) => s.title), ["紐崔萊", "雅姿", "益之源"]);
  // 品牌卡最前面是「實戰百寶箱」連結區塊，封面＝實戰百寶箱課程封面
  const card = (await call<CourseDetail>("GET", "/courses/cbbb", { token: admin })).data;
  assert.equal(card.lessons[0]!.title, "實戰百寶箱");
  assert.equal(card.lessons[0]!.linkedCourseId, "cqqxw4z2");
  assert.match(card.lessons[0]!.coverUrl ?? "", /course%2Fbox\.jpg/);
  // 教材：在實戰百寶箱最後一個區塊（益之源）加一個，益之源品牌卡立刻看到；雅姿卡不會有
  await run("INSERT INTO lessons (id, course_id, position, title, kind, media_type, media_ref) VALUES ('t1', 'cqqxw4z2', 100, '百寶箱影片', 'material', 'youtube', 'AAAAAAAAAAA')");
  const bc = (await call<CourseDetail>("GET", "/courses/cbbc", { token: admin })).data;
  assert.ok(bc.lessons.some((l) => l.title === "百寶箱影片" && l.courseId === "cqqxw4z2"));
  assert.ok(!card.lessons.some((l) => l.title === "百寶箱影片"));
  // 品牌改名 → 區塊名稱跟著改
  await run("UPDATE brand_logos SET name = '雅姿 Artistry' WHERE id = 'bb'");
  await ensureTreasureLinks(env, "bb");
  assert.ok((await sections()).some((s) => s.title === "雅姿 Artistry"));
  // 順序：品牌館卡片順序（益之源、紐崔萊、雅姿）→ 實戰百寶箱區塊跟著排
  const put = await call("PUT", "/admin/ui-config", { token: admin, body: { seriesOrder: ["c:cbbc", "c:cbba", "c:cbbb"] } });
  assert.equal(put.status, 200);
  assert.deepEqual((await sections()).map((s) => s.brand_id), ["bc", "ba", "bb"]);
  // 反向：在實戰百寶箱把順序改成 雅姿、益之源、紐崔萊 → 品牌館卡片順序跟著改
  const lessons = (await call<CourseDetail>("GET", "/courses/cqqxw4z2", { token: admin })).data.lessons.filter((l) => l.material && !l.full);
  const ids = (await db.prepare("SELECT id, brand_id, kind FROM lessons WHERE course_id = 'cqqxw4z2' ORDER BY position").all<{ id: string; brand_id: string | null; kind: string }>()).results;
  assert.ok(lessons.length >= 3);
  const byBrand = (b: string) => ids.find((r) => r.brand_id === b)!.id;
  const rest = ids.filter((r) => r.kind !== "section").map((r) => r.id);
  const order = await call("POST", "/admin/courses/cqqxw4z2/lessons/order", { token: admin, body: { ids: [byBrand("bb"), byBrand("bc"), byBrand("ba"), ...rest] } });
  assert.equal(order.status, 200, JSON.stringify(order.data));
  assert.deepEqual((await loadConfig(db)).seriesOrder.filter((k) => k.startsWith("c:cb")), ["c:cbbb", "c:cbbc", "c:cbba"]);
});
