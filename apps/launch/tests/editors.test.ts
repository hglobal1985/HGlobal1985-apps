import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CenterArt, CourseDetail, CourseEditor, CourseSummary, EditorCandidate, Member } from "../src/contract.ts";
import type { Env, R2Bucket } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

function memR2(): R2Bucket {
  const objects = new Map<string, Uint8Array>();
  return {
    async head(key: string) {
      return objects.has(key) ? { size: objects.get(key)!.byteLength, httpMetadata: {} } : null;
    },
    async get(key: string) {
      const o = objects.get(key);
      return o ? { size: o.byteLength, httpMetadata: { contentType: "image/jpeg" }, body: new Response(o as Uint8Array<ArrayBuffer>).body! } : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
    async put(key: string, value: ArrayBuffer) {
      objects.set(key, new Uint8Array(value));
    },
  } as unknown as R2Bucket;
}

function setup() {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on", MEDIA: memR2() };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown; bytes?: Uint8Array } = {}) => {
    const res = await handleApi(
      new Request(`https://learn.test/api/v2${path}`, {
        method,
        headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
        body: (opts.bytes as Uint8Array<ArrayBuffer> | undefined) ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
      }),
      env,
    );
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  return { env, call, login };
}

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 50 }, (_, i) => i)]);

test("小編：會長從同中心名單指派；三種權限各自生效；換權限、移除後立即生效；有通知", async () => {
  const { env, call, login } = setup();
  const [admin, pres, desk, student] = await Promise.all(["demo-admin", "demo-president", "demo-desk", "demo-student"].map(login));

  // 名單：同中心（台北）、不含自己；一般學員不能查
  const cand = await call<{ members: EditorCandidate[] }>("GET", "/admin/editors/candidates", { token: pres });
  assert.equal(cand.status, 200);
  assert.deepEqual(cand.data.members.map((m) => m.memberId).sort(), ["demo-desk", "demo-student"]);
  assert.equal((await call("GET", "/admin/editors/candidates", { token: student })).status, 403);
  assert.equal((await call("POST", "/admin/editors", { token: student, body: { memberId: "demo-desk" } })).status, 403);
  // 會長不能管別的中心
  assert.equal((await call("GET", "/admin/editors?center=台中中心", { token: pres })).status, 403);

  // 指派：預設只有「新增」
  const added = await call<CourseEditor[]>("POST", "/admin/editors", { token: pres, body: { memberId: "demo-desk", name: "測試窗口" } });
  assert.equal(added.status, 200);
  assert.deepEqual(added.data.map((e) => [e.memberId, e.center, e.canCreate, e.canEditOthers, e.canDeleteOthers]), [["demo-desk", "台北中心", true, false, false]]);
  assert.equal((await call("POST", "/admin/editors", { token: pres, body: { memberId: "demo-desk" } })).status, 409, "不重複指派");
  const note = await env.DB.prepare("SELECT title FROM notifications WHERE recipient_sub = 'demo-desk'").first<{ title: string }>();
  assert.match(note!.title, /小編/);

  // 小編的 /me
  const me = (await call<{ member: Member }>("GET", "/me", { token: desk })).data.member;
  assert.deepEqual(me.courseRights, { all: false, create: true, manageEditors: false, center: "台北中心", editor: { create: true, editOthers: false, deleteOthers: false } });
  assert.ok(me.titles.includes("小編"));
  assert.equal((await call("GET", "/admin/editors", { token: desk })).status, 403, "小編不能管理小編");

  // 會長的課、小編自己的課
  const presCourse = (await call<CourseDetail>("POST", "/admin/courses", { token: pres, body: { title: "會長的課" } })).data.id;
  const mine = await call<CourseDetail>("POST", "/admin/courses", { token: desk, body: { title: "小編的課", hostUnit: "台中中心" } });
  assert.equal(mine.status, 200);
  assert.equal(mine.data.hostUnit, "台北中心", "主辦中心固定是自己的中心");
  assert.equal(mine.data.admin?.mine, true);
  assert.deepEqual(mine.data.admin?.can, { edit: true, remove: true, restore: false });
  assert.equal(mine.data.admin?.editedByName, "測試窗口");
  assert.equal((await call("PATCH", `/admin/courses/${mine.data.id}`, { token: desk, body: { title: "小編的課（改）", status: "published" } })).status, 200);
  assert.equal((await call("POST", `/admin/courses/${mine.data.id}/lessons`, { token: desk, body: { title: "第二堂" } })).status, 200);

  // 別人的課：沒有「修改別人」就不能改、看不到別人的草稿
  assert.equal((await call("PATCH", `/admin/courses/${presCourse}`, { token: desk, body: { title: "亂改" } })).status, 403);
  assert.equal((await call("POST", `/admin/courses/${presCourse}/lessons`, { token: desk, body: { title: "x" } })).status, 403);
  assert.equal((await call("GET", `/courses/${presCourse}`, { token: desk })).status, 404, "別人的草稿看不到");
  const list = (await call<CourseSummary[]>("GET", "/admin/courses", { token: desk })).data;
  assert.equal(list.some((c) => c.id === presCourse), false);
  assert.equal(list.find((c) => c.id === mine.data.id)?.can?.edit, true);

  // 開「修改別人」
  assert.equal((await call("PATCH", "/admin/editors/demo-desk", { token: pres, body: { canEditOthers: true } })).status, 200);
  assert.equal((await call("PATCH", `/admin/courses/${presCourse}`, { token: desk, body: { title: "會長的課（小編改）", status: "published" } })).status, 200);
  assert.equal((await call("DELETE", `/admin/courses/${presCourse}`, { token: desk })).status, 403, "沒有「刪除別人」");
  assert.equal((await call("PATCH", `/admin/courses/${presCourse}`, { token: desk, body: { status: "archived" } })).status, 403, "下架封存也算刪除權限");
  // 開「刪除別人」
  assert.equal((await call("PATCH", "/admin/editors/demo-desk", { token: pres, body: { canDeleteOthers: true } })).status, 200);
  assert.equal((await call("PATCH", `/admin/courses/${presCourse}`, { token: desk, body: { status: "archived" } })).status, 200);
  assert.equal((await call("PATCH", `/admin/courses/${presCourse}`, { token: desk, body: { status: "published" } })).status, 403, "還原只有總部、會長、音控");
  assert.equal((await call("PATCH", `/admin/courses/${presCourse}`, { token: pres, body: { status: "published" } })).status, 200);

  // 別的中心的課一律不行
  const other = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "台中的課", hostUnit: "台中中心" } })).data.id;
  assert.equal((await call("PATCH", `/admin/courses/${other}`, { token: desk, body: { title: "x" } })).status, 403);

  // 關掉「新增」：不能新增，但自己的課仍可以改
  assert.equal((await call("PATCH", "/admin/editors/demo-desk", { token: pres, body: { canCreate: false } })).status, 200);
  assert.equal((await call("POST", "/admin/courses", { token: desk, body: { title: "不行" } })).status, 403);
  assert.equal((await call("PATCH", `/admin/courses/${mine.data.id}`, { token: desk, body: { subtitle: "還可以改" } })).status, 200);

  // 移除：權限立即消失、有通知
  assert.equal((await call("DELETE", "/admin/editors/demo-desk", { token: pres })).status, 200);
  assert.equal((await call("PATCH", `/admin/courses/${mine.data.id}`, { token: desk, body: { subtitle: "x" } })).status, 403);
  assert.equal((await call<{ member: Member }>("GET", "/me", { token: desk })).data.member.courseRights, undefined);
  const notes = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE recipient_sub = 'demo-desk'").first<{ n: number }>();
  assert.equal(notes!.n, 2);

  // 總部：可以指定任何中心
  assert.equal((await call("POST", "/admin/editors", { token: admin, body: { memberId: "demo-silver", center: "台中中心", canEditOthers: true } })).status, 200);
  const all = (await call<CourseEditor[]>("GET", "/admin/editors", { token: admin })).data;
  assert.deepEqual(all.map((e) => [e.memberId, e.center]), [["demo-silver", "台中中心"]]);
});

test("別人剛改過：帶 ifUpdatedAt 的儲存會被擋下，force 可覆蓋；最後修改者會更新", async () => {
  const { call, login } = setup();
  const [admin, pres] = await Promise.all(["demo-admin", "demo-president"].map(login));
  const c = (await call<CourseDetail>("POST", "/admin/courses", { token: pres, body: { title: "衝突測試" } })).data;
  const stamp = c.admin!.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await call("PATCH", `/admin/courses/${c.id}`, { token: admin, body: { subtitle: "總部先改", ifUpdatedAt: stamp } })).status, 200);
  const late = await call<{ error: { code: string; message: string } }>("PATCH", `/admin/courses/${c.id}`, { token: pres, body: { subtitle: "會長後改", ifUpdatedAt: stamp } });
  assert.equal(late.status, 409);
  assert.equal(late.data.error.code, "edit_conflict");
  assert.match(late.data.error.message, /測試管理員/);
  const forced = await call<CourseDetail>("PATCH", `/admin/courses/${c.id}`, { token: pres, body: { subtitle: "會長後改", ifUpdatedAt: stamp, force: true } });
  assert.equal(forced.status, 200);
  assert.equal(forced.data.admin?.editedByName, "測試會長");
  // 章節修改也記下最後修改者
  await call("POST", `/admin/courses/${c.id}/lessons`, { token: admin, body: { title: "新章節" } });
  assert.equal((await call<CourseDetail>("GET", `/courses/${c.id}`, { token: pres })).data.admin?.editedByName, "測試管理員");
});

test("中心 EDM：總部任何中心、會長自己中心、小編要有「修改別人」；全部課程頁讀得到；短網址可設中心（只有超級管理員）", async () => {
  const { call, login } = setup();
  const [admin, pres, desk, student] = await Promise.all(["demo-admin", "demo-president", "demo-desk", "demo-student"].map(login));
  assert.equal((await call("PUT", "/admin/center-art?center=台北中心", { token: pres, bytes: jpeg })).status, 200);
  assert.equal((await call("PUT", "/admin/center-art?center=台中中心", { token: pres, bytes: jpeg })).status, 403);
  assert.equal((await call("PUT", "/admin/center-art?center=台北中心", { token: student, bytes: jpeg })).status, 403);
  await call("POST", "/admin/editors", { token: pres, body: { memberId: "demo-desk" } });
  assert.equal((await call("PUT", "/admin/center-art?center=台北中心", { token: desk, bytes: jpeg })).status, 403);
  await call("PATCH", "/admin/editors/demo-desk", { token: pres, body: { canEditOthers: true } });
  assert.equal((await call("PUT", "/admin/center-art?center=台北中心", { token: desk, bytes: jpeg })).status, 200);
  assert.equal((await call("PUT", "/admin/center-art?center=台中中心", { token: admin, bytes: jpeg })).status, 200);
  const art = (await call<CenterArt[]>("GET", "/center-art")).data;
  assert.deepEqual(art.map((a) => a.center), ["台中中心", "台北中心"]);
  assert.ok(art[0]!.edmUrl.startsWith("/api/v2/media/pub?k=center"));
  assert.equal((await call("DELETE", "/admin/center-art?center=台北中心", { token: pres })).status, 200);
  assert.equal((await call<CenterArt[]>("GET", "/center-art")).data.length, 1);

  // 短網址（中心）：只有超級管理員
  assert.equal((await call("PUT", "/admin/short-links", { token: pres, body: { kind: "center", value: "台北中心", slug: "taipei" } })).status, 403);
  assert.equal((await call("PUT", "/admin/short-links", { token: admin, body: { kind: "center", value: "台北中心", slug: "taipei" } })).status, 200);
  assert.deepEqual((await call("GET", "/short-links/taipei")).data, { kind: "center", value: "台北中心" });
});
