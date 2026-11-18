import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import { ensureBrandCards, NEW_PRODUCT_LIST_TITLE } from "../src/brand-cards.ts";
import type { CourseDetail, CourseSummary } from "../src/contract.ts";
import type { Env, R2Bucket } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("品牌資訊卡：每個品牌一張、6 個預設區塊、第一區塊連結新品清單（內容同步、排序與播放回到來源）", async () => {
  const db = createTestDb();
  const store = new Map<string, Uint8Array>([["system/brand-demo-wide.jpg", new Uint8Array([1])], ["system/brand-demo-tall.jpg", new Uint8Array([2])]]);
  const r2 = {
    async put(k: string, v: ArrayBuffer) { store.set(k, new Uint8Array(v)); },
    async get(k: string) { const v = store.get(k); return v ? { body: new Blob([v]).stream() } : null; },
    async head() { return null; },
    async delete() {},
    async list() { return { objects: [], truncated: false }; },
  } as unknown as R2Bucket;
  const env: Env = { DB: db, DEMO_LOGIN: "on", MEDIA: r2 };
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  // 新品清單：有「紐崔萊」品牌區塊（2 個教材）、一個別的區塊；品牌 2 個（紐崔萊、R&J 沒有區塊）
  await run("INSERT INTO brand_logos (id, name, sort_order) VALUES ('bn', '紐崔萊', 1), ('br', 'R&J', 2)");
  await run("INSERT INTO courses (id, title, is_list, status, series, view_scope, is_public) VALUES ('cnew', ?, 1, 'published', ?, 'all', 1)", NEW_PRODUCT_LIST_TITLE, NEW_PRODUCT_LIST_TITLE);
  await run("INSERT INTO lessons (id, course_id, position, title, kind, media_type, brand_id) VALUES ('nsec', 'cnew', 1, '紐崔萊 Nutrilite', 'section', 'demo', 'bn')");
  await run("INSERT INTO lessons (id, course_id, position, title, kind, media_type, media_ref) VALUES ('n1', 'cnew', 2, '影片一', 'material', 'youtube', 'AAAAAAAAAAA'), ('n2', 'cnew', 3, '影片二', 'material', 'youtube', 'BBBBBBBBBBB')");
  await run("INSERT INTO lessons (id, course_id, position, title, kind, media_type) VALUES ('osec', 'cnew', 4, '別的區塊', 'section', 'demo')");
  await run("INSERT INTO lessons (id, course_id, position, title, kind, media_type, media_ref) VALUES ('o1', 'cnew', 5, '別的影片', 'material', 'youtube', 'CCCCCCCCCCC')");
  await run("INSERT INTO series_art (series, edm_key, cover_key, art_version) VALUES (?, 'series/x/edm.jpg', 'series/x/cover.jpg', 3)", NEW_PRODUCT_LIST_TITLE);
  assert.equal(await ensureBrandCards(env), 2);
  assert.equal(await ensureBrandCards(env), 0); // 可重複執行
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const admin = (await call<{ token: string }>("POST", "/auth/demo", { body: { sub: "demo-admin" } })).data.token;
  const card = (await call<CourseDetail>("GET", "/courses/cbbn", { token: admin })).data;
  assert.equal(card.zone, "amway_brand");
  assert.equal(card.brandId, "bn");
  const titles = card.lessons.map((l) => l.title);
  assert.deepEqual(titles, ["新品特惠培訓直播", "影片一", "影片二", "產品示範", "宣傳短片", "媒體曝光", "專家說", "其他未分類"]);
  const head = card.lessons[0]!;
  assert.equal(head.linkedCourseId, "cnew");
  assert.equal(head.linkedBlockId, "nsec");
  assert.match(head.coverUrl ?? "", /series%2Fx%2Fcover\.jpg/); // 封面＝新品清單的系列封面
  assert.equal(card.lessons[1]!.courseId, "cnew");
  assert.ok(card.lessons[3]!.coverUrl && card.lessons[3]!.posterUrl); // 產品示範有封面
  // 沒有區塊的品牌：新品清單自動補一個
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE course_id = 'cnew' AND kind = 'section' AND brand_id = 'br'").first<{ n: number }>())?.n, 1);
  // 同步：來源清單改了（刪掉影片二），卡片立刻一樣
  await run("DELETE FROM lessons WHERE id = 'n2'");
  assert.deepEqual((await call<CourseDetail>("GET", "/courses/cbbn", { token: admin })).data.lessons.slice(0, 3).map((l) => l.title), ["新品特惠培訓直播", "影片一", "產品示範"]);
  await run("INSERT INTO lessons (id, course_id, position, title, kind, media_type, media_ref) VALUES ('n3', 'cnew', 3, '影片三', 'material', 'youtube', 'DDDDDDDDDDD')");
  // 排序：在卡片裡把影片三換到影片一前面，來源清單跟著換
  const cur = (await call<CourseDetail>("GET", "/courses/cbbn", { token: admin })).data.lessons.filter((l) => l.material && !l.full).map((l) => l.id);
  const next = [cur[0]!, "n3", "n1", ...cur.slice(3)];
  const ord = await call("POST", "/admin/courses/cbbn/lessons/order", { token: admin, body: { ids: next } });
  assert.equal(ord.status, 200, JSON.stringify([ord.data, next]));
  assert.deepEqual((await db.prepare("SELECT id FROM lessons WHERE course_id = 'cnew' ORDER BY position").all<{ id: string }>()).results.map((r) => r.id).slice(0, 3), ["nsec", "n3", "n1"]);
  // 播放：卡片網址下播放連結區塊裡的影片
  const pb = await call<{ kind: string; videoId: string }>("GET", "/courses/cbbn/lessons/n1/playback", { token: admin });
  assert.equal(pb.status, 200);
  assert.equal(pb.data.videoId, "AAAAAAAAAAA");
  // 寰宇大學清單的區塊數量（連結區塊用來源數字）
  const list = (await call<CourseSummary[]>("GET", "/courses", { token: admin })).data.find((c) => c.id === "cbbn")!;
  assert.equal(list.blocks[0]!.count, 2);
});
