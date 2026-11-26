import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

// 業主 2026-11-21：封面輪播與相簿（照片、短影音）。
type R2Bucket = NonNullable<Env["MEDIA"]>;
function memR2(): R2Bucket {
  const m = new Map<string, { body: Uint8Array; httpMetadata?: { contentType?: string } }>();
  return {
    put: async (k: string, v: ArrayBuffer | Uint8Array, o?: { httpMetadata?: { contentType?: string } }) => void m.set(k, { body: new Uint8Array(v as ArrayBuffer), httpMetadata: o?.httpMetadata }),
    get: async (k: string, o?: { range?: { offset: number; length: number } }) => {
      const x = m.get(k);
      if (!x) return null;
      const b = o?.range ? x.body.slice(o.range.offset, o.range.offset + o.range.length) : x.body;
      return { ...x, body: new Response(b as unknown as BodyInit).body };
    },
    head: async (k: string) => (m.has(k) ? { size: m.get(k)!.body.byteLength, httpMetadata: m.get(k)!.httpMetadata } : null),
    delete: async (k: string) => void m.delete(k),
    list: async () => ({ objects: [...m.keys()].map((key) => ({ key, size: 1 })), truncated: false }),
    _keys: () => [...m.keys()],
  } as unknown as R2Bucket;
}
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 50 }, (_, i) => i)]);
const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, ...Array.from({ length: 40 }, (_, i) => i)]);

test("封面輪播與相簿：上傳照片與影片、排序、Range 播放、刪除、權限", async () => {
  const bucket = memR2();
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on", MEDIA: bucket };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown; bytes?: Uint8Array } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { ...(opts.bytes ? {} : { "content-type": "application/json" }), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: (opts.bytes as unknown as BodyInit | undefined) ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) }), env);
    const text = await res.text();
    return { status: res.status, data: (text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const [admin, a] = await Promise.all([login("demo-admin"), login("demo-student")]);
  type Item = { id: string; kind: string; url: string; posterUrl: string | null; width: number; height: number };
  type Res = { id: string; items: Item[] };
  const C = encodeURIComponent("台北中心");
  assert.deepEqual((await call<Item[]>("GET", `/cover-media?kind=center&key=${C}`)).data, [], "沒上傳過是空的，訪客也能讀");

  assert.equal((await call("PUT", `/admin/cover-media?kind=center&key=${C}&w=100&h=200`, { token: a, bytes: jpeg })).status, 403, "一般會員不能上傳");
  assert.equal((await call("PUT", `/admin/cover-media?kind=center&key=${C}`, { token: admin, bytes: new Uint8Array([1, 2, 3]) })).status, 400, "不是圖片");
  const p1 = await call<Res>("PUT", `/admin/cover-media?kind=center&key=${C}&w=1200&h=800`, { token: admin, bytes: jpeg });
  assert.equal(p1.status, 200);
  const p2 = await call<Res>("PUT", `/admin/cover-media?kind=center&key=${C}&w=600&h=900`, { token: admin, bytes: jpeg });
  assert.deepEqual(p2.data.items.map((x) => [x.width, x.height]), [[1200, 800], [600, 900]], "依上傳順序，記下寬高");
  const img = await handleApi(new Request(`https://learn.test${p2.data.items[0]!.url}`), env);
  assert.equal(img.status, 200, "圖片網址公開可讀");

  // 影片：要 MP4／WebM、過長或過大被擋；有預覽圖、Range 播放
  assert.equal((await call("PUT", `/admin/cover-media/video?kind=center&key=${C}`, { token: admin, bytes: jpeg })).status, 400, "不是影片");
  assert.equal((await call("PUT", `/admin/cover-media/video?kind=center&key=${C}&dur=500`, { token: admin, bytes: mp4 })).status, 413, "太長");
  const v = await call<Res>("PUT", `/admin/cover-media/video?kind=center&key=${C}&w=720&h=1280&dur=30`, { token: admin, bytes: mp4 });
  assert.equal(v.status, 200);
  const video = v.data.items.find((x) => x.kind === "video")!;
  assert.equal((await call("PUT", `/admin/cover-media/${v.data.id}/poster`, { token: admin, bytes: jpeg })).status, 200);
  const list = (await call<Item[]>("GET", `/cover-media?kind=center&key=${C}`)).data;
  assert.ok(list.find((x) => x.id === video.id)!.posterUrl);
  const ranged = await handleApi(new Request(`https://learn.test${video.url}`, { headers: { range: "bytes=0-9" } }), env);
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), `bytes 0-9/${mp4.byteLength}`);
  assert.equal((await ranged.arrayBuffer()).byteLength, 10);
  assert.equal((await handleApi(new Request("https://learn.test/api/v2/media/album?k=album/x/none.mp4"), env)).status, 404);

  // 排序
  const ids = list.map((x) => x.id);
  const re = await call<{ items: Item[] }>("POST", "/admin/cover-media/order", { token: admin, body: { kind: "center", key: "台北中心", ids: [ids[2], ids[0], ids[1]] } });
  assert.deepEqual(re.data.items.map((x) => x.id), [ids[2], ids[0], ids[1]]);

  // 刪除（徹底刪檔）、權限
  assert.equal((await call("DELETE", `/admin/cover-media/${ids[0]}`, { token: a })).status, 403);
  const before = (bucket as unknown as { _keys: () => string[] })._keys().length;
  const del = await call<{ items: Item[] }>("DELETE", `/admin/cover-media/${ids[0]}`, { token: admin });
  assert.equal(del.data.items.length, 2);
  assert.equal((bucket as unknown as { _keys: () => string[] })._keys().length, before - 1, "雲端檔案一起刪掉");

  // 系列只有超級管理員
  assert.equal((await call("PUT", "/admin/cover-media?kind=series&key=U40", { token: a, bytes: jpeg })).status, 403);
  assert.equal((await call("PUT", "/admin/cover-media?kind=series&key=U40&w=10&h=10", { token: admin, bytes: jpeg })).status, 200);
  assert.equal((await call<Item[]>("GET", "/cover-media?kind=series&key=U40")).data.length, 1);
});

test("封面輪播照片與 EDM 分頁照片分開儲存：各自上限、各自排序、封面輪播是否顯示 EDM（業主 2026-11-23）", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on", MEDIA: memR2() };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown; bytes?: Uint8Array } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { ...(opts.bytes ? {} : { "content-type": "application/json" }), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.bytes ? (opts.bytes as unknown as BodyInit) : opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    const text = await res.text();
    return { status: res.status, data: (text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const [admin, student] = await Promise.all([login("demo-admin"), login("demo-student")]);
  type Item = { id: string; scope: string; width: number };
  const C = encodeURIComponent("台北中心");
  const put = (scope: string | null, w: number) => call<{ id: string }>("PUT", `/admin/cover-media?kind=center&key=${C}&w=${w}&h=800${scope ? `&scope=${scope}` : ""}`, { token: admin, bytes: jpeg });

  const e1 = await put("edm", 1200);
  const e2 = await put(null, 1300); // 沒帶 scope：中心當 edm（舊版相簿上傳）
  const c1 = await put("cover", 1400);
  const c2 = await put("cover", 1500);
  assert.ok(e1.data.id && e2.data.id && c1.data.id && c2.data.id);
  const all = (await call<Item[]>("GET", `/cover-media?kind=center&key=${C}`)).data;
  assert.deepEqual(all.map((x) => [x.scope, x.width]), [["cover", 1400], ["cover", 1500], ["edm", 1200], ["edm", 1300]], "兩區各自排序，公開讀取兩區都回（封面在前）");

  // 排序只動指定的那一區
  await call("POST", "/admin/cover-media/order", { token: admin, body: { kind: "center", key: "台北中心", scope: "cover", ids: [c2.data.id, c1.data.id] } });
  const after = (await call<Item[]>("GET", `/cover-media?kind=center&key=${C}`)).data;
  assert.deepEqual(after.map((x) => [x.scope, x.width]), [["cover", 1500], ["cover", 1400], ["edm", 1200], ["edm", 1300]], "封面區重排，EDM 區不變");

  // 系列、課程只有封面區：就算帶 scope=edm 也一律存成 cover
  const s1 = await call<{ id: string }>("PUT", `/admin/cover-media?kind=series&key=${encodeURIComponent("某系列")}&w=100&h=100&scope=edm`, { token: admin, bytes: jpeg });
  assert.equal(s1.status, 200);
  assert.equal((await call<Item[]>("GET", `/cover-media?kind=series&key=${encodeURIComponent("某系列")}`)).data[0]!.scope, "cover");

  // 封面輪播是否顯示 EDM：沒設定＝預設打勾；只有能編輯該中心封面的人可以改
  assert.deepEqual((await call("GET", `/cover-media/config?center=${C}`)).data, { showEdm: true });
  assert.equal((await call("PUT", "/admin/cover-media/config", { token: student, body: { kind: "center", key: "台北中心", showEdm: false } })).status, 403);
  assert.deepEqual((await call("PUT", "/admin/cover-media/config", { token: admin, body: { kind: "center", key: "台北中心", showEdm: false } })).data, { showEdm: false });
  assert.deepEqual((await call("GET", `/cover-media/config?center=${C}`)).data, { showEdm: false });
  assert.deepEqual((await call("PUT", "/admin/cover-media/config", { token: admin, body: { kind: "center", key: "台北中心", showEdm: true } })).data, { showEdm: true });
  assert.deepEqual((await call("GET", `/cover-media/config?center=${C}`)).data, { showEdm: true });
});

test("課程 EDM 併入中心 EDM 空間：已上傳與未來上傳的自動綁定；綁定的不能刪只能更換；同步換圖、下架、改中心（業主 2026-11-23）", async () => {
  const bucket = memR2();
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on", MEDIA: bucket };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown; bytes?: Uint8Array } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { ...(opts.bytes ? {} : { "content-type": "application/json" }), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.bytes ? (opts.bytes as unknown as BodyInit) : opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    const text = await res.text();
    return { status: res.status, data: (text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text) as T };
  };
  const admin = (await call<{ token: string }>("POST", "/auth/demo", { body: { sub: "demo-admin" } })).data.token;
  type Item = { id: string; scope: string; courseId?: string; courseTitle?: string; url: string; width: number; height: number };
  const C = encodeURIComponent("台北中心");
  const list = async (center = C) => (await call<Item[]>("GET", `/cover-media?kind=center&key=${center}`)).data;

  // 已經上傳的課程 EDM：台北中心主辦、已發佈、有 EDM
  await bucket.put("edm/c-a/old.jpg", jpeg);
  await db.prepare("UPDATE courses SET host_center_key = '台北中心', edm_key = 'edm/c-a/old.jpg', status = 'published' WHERE id = 'start'").run();
  const own = await call<{ id: string }>("PUT", `/admin/cover-media?kind=center&key=${C}&w=1200&h=800&scope=edm`, { token: admin, bytes: jpeg }); // 手動上傳的 EDM（沒綁課程）
  let items = await list();
  const bound = items.filter((x) => x.courseId);
  assert.equal(bound.length, 1, "課程 EDM 自動出現在中心 EDM 空間");
  assert.equal(bound[0]!.courseId, "start");
  assert.ok(bound[0]!.courseTitle);
  assert.equal(bound[0]!.scope, "edm");
  assert.equal(items.length, 2);

  // 綁定的不能刪；沒綁定的照舊能刪
  const del = await call<{ error: { code: string; message: string } }>("DELETE", `/admin/cover-media/${bound[0]!.id}`, { token: admin });
  assert.equal(del.status, 409);
  assert.equal(del.data.error.code, "bound_to_course");
  assert.equal((await call("DELETE", `/admin/cover-media/${own.data.id}`, { token: admin })).status, 200);

  // 更換照片：同時換掉那堂課的 EDM
  const rep = await call<{ items: Item[] }>("PUT", `/admin/cover-media/${bound[0]!.id}/replace?w=600&h=900`, { token: admin, bytes: jpeg });
  assert.equal(rep.status, 200);
  const course = await db.prepare("SELECT edm_key FROM courses WHERE id = 'start'").first<{ edm_key: string }>();
  assert.notEqual(course!.edm_key, "edm/c-a/old.jpg");
  assert.ok(course!.edm_key.startsWith("edm/start/"), "新檔仍放在這堂課自己的路徑");
  assert.equal((await bucket.head("edm/c-a/old.jpg")), null, "舊檔已刪");
  items = await list();
  assert.equal(items.filter((x) => x.courseId).length, 1);
  assert.equal((await call("PUT", `/admin/cover-media/${bound[0]!.id}/replace`, { bytes: jpeg })).status, 401, "沒登入不能更換");

  // 未來上傳／課程自己換 EDM：下次讀取自動同步，仍然只有一張
  await db.prepare("UPDATE courses SET edm_key = 'edm/start/other.jpg' WHERE id = 'start'").run();
  await bucket.put("edm/start/other.jpg", jpeg);
  items = await list();
  assert.equal(items.filter((x) => x.courseId).length, 1);
  assert.ok(items.find((x) => x.courseId)!.url.includes("other.jpg"));

  // 改到別的中心：整張跟著搬過去；下架：從空間拿掉（檔案仍歸課程）
  await db.prepare("UPDATE courses SET host_center_key = '台中中心' WHERE id = 'start'").run();
  assert.equal((await list()).filter((x) => x.courseId).length, 0);
  assert.equal((await list(encodeURIComponent("台中中心"))).filter((x) => x.courseId).length, 1);
  await db.prepare("UPDATE courses SET status = 'draft' WHERE id = 'start'").run();
  assert.equal((await list(encodeURIComponent("台中中心"))).filter((x) => x.courseId).length, 0);
  assert.ok(await bucket.head("edm/start/other.jpg"), "課程自己的檔案沒被刪");
});

test("相簿專區 GET /albums：全站相簿照片依來源分資料夾（業主 2026-11-25）", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on", MEDIA: memR2() };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; bytes?: Uint8Array } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.bytes as unknown as BodyInit | undefined }), env);
    const text = await res.text();
    return { status: res.status, data: (text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text) as T };
  };
  type Albums = { total: number; groups: { id: string; label: string; folders: { id: string; kind: string; key: string; title: string; count: number; thumb: string | null }[] }[] };
  assert.deepEqual((await call<Albums>("GET", "/albums")).data, { total: 0, groups: [] }, "沒有照片＝空");
  const admin = ((await (await handleApi(new Request("https://learn.test/api/v2/auth/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sub: "demo-admin" }) }), env)).json()) as { token: string }).token;
  await call("PUT", `/admin/cover-media?kind=center&key=${encodeURIComponent("台北中心")}&scope=edm&w=10&h=10`, { token: admin, bytes: jpeg });
  await call("PUT", "/admin/cover-media?kind=series&key=U40&w=10&h=10", { token: admin, bytes: jpeg });
  await call("PUT", "/admin/cover-media?kind=series&key=U40&w=10&h=10", { token: admin, bytes: jpeg });
  const r = (await call<Albums>("GET", "/albums")).data;
  assert.equal(r.total, 3);
  assert.deepEqual(r.groups.map((g) => g.id), ["edm", "series"], "依來源分組、沒有的組不列");
  assert.equal(r.groups[1]!.folders[0]!.count, 2);
  assert.ok(r.groups[1]!.folders[0]!.thumb, "有縮圖");
});

test("相簿專區：資料夾依張數多到少、大類別順序可調、單一資料夾與全部搜尋（業主 2026-11-25）", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on", MEDIA: memR2() };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; bytes?: Uint8Array; json?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { ...(opts.json ? { "content-type": "application/json" } : {}), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: (opts.json ? JSON.stringify(opts.json) : opts.bytes) as unknown as BodyInit | undefined }), env);
    const text = await res.text();
    return { status: res.status, data: (text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text) as T };
  };
  type Folder = { id: string; count: number; title: string; locked: boolean; canEdit: boolean; thumbs: string[] };
  type Albums = { groups: { id: string; folders: Folder[] }[] };
  const admin = (await call<{ token: string }>("POST", "/auth/demo", { json: { sub: "demo-admin" } })).data.token;
  await call("PUT", "/admin/cover-media?kind=series&key=A&w=10&h=10", { token: admin, bytes: jpeg });
  for (let i = 0; i < 3; i++) await call("PUT", "/admin/cover-media?kind=series&key=B&w=10&h=10", { token: admin, bytes: jpeg });
  await call("PUT", `/admin/cover-media?kind=center&key=${encodeURIComponent("台北中心")}&scope=edm&w=10&h=10`, { token: admin, bytes: jpeg });
  const r = (await call<Albums>("GET", "/albums")).data;
  assert.deepEqual(r.groups.map((g) => g.id), ["edm", "series"], "預設順序");
  assert.deepEqual(r.groups[1]!.folders.map((f) => f.title), ["B", "A"], "子項目按張數多到少");
  assert.equal(r.groups[1]!.folders[0]!.thumbs.length, 3);
  assert.equal(r.groups[1]!.folders[0]!.canEdit, false, "訪客不能上傳");
  const adm = (await call<Albums>("GET", "/albums", { token: admin })).data;
  assert.equal(adm.groups[1]!.folders[0]!.canEdit, true, "超級管理員可上傳");
  // 大類別順序：只有超級管理員能改
  assert.equal((await call("PUT", "/admin/ui-config", { json: { albumOrder: ["series", "edm"] } })).status, 401);
  assert.equal((await call("PUT", "/admin/ui-config", { token: admin, json: { albumOrder: ["series", "edm", "bogus"] } })).status, 200);
  assert.deepEqual((await call<Albums>("GET", "/albums")).data.groups.map((g) => g.id), ["series", "edm"], "依設定的大類別順序");
  const f = await call<{ items: unknown[] }>("GET", `/albums/folder?id=${encodeURIComponent("series:B")}`);
  assert.equal(f.status, 200);
  assert.equal(f.data.items.length, 3);
  assert.equal((await call("GET", `/albums/folder?id=${encodeURIComponent("series:none")}`)).status, 404);
  assert.deepEqual((await call<{ items: unknown[] }>("GET", "/albums/search?q=a")).data.items, [], "太短不搜");
});

test("相簿權限：獎銜達標可上傳、資料夾設定優先於類別、資訊總覽與瀏覽數（業主 2026-11-25）", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on", MEDIA: memR2() };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; bytes?: Uint8Array; json?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { ...(opts.json ? { "content-type": "application/json" } : {}), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: (opts.json ? JSON.stringify(opts.json) : opts.bytes) as unknown as BodyInit | undefined }), env);
    const text = await res.text();
    return { status: res.status, data: (text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { json: { sub } })).data.token;
  const [admin, stu] = await Promise.all([login("demo-admin"), login("demo-student")]);
  await db.prepare("INSERT INTO courses (id, title, is_list, status, view_scope, is_public, zone, block_photos) VALUES ('cx', '某課程', 0, 'published', 'all', 1, 'hglobal', 1)").run();
  await db.prepare("INSERT INTO lessons (id, course_id, position, title, kind, media_type) VALUES ('bx', 'cx', 1, '某區塊', 'section', 'demo')").run();
  const up = (token: string) => call("PUT", "/admin/cover-media?kind=course&key=bx&w=10&h=10", { token, bytes: jpeg });
  await db.prepare("DELETE FROM album_permissions").run();
  assert.equal((await up(stu)).status, 403, "沒設定：一般會員不能上傳");
  // 只有超級管理員能改權限
  assert.equal((await call("PUT", "/admin/albums/permission", { token: stu, json: { key: "block:bx", uploadMinRank: "none" } })).status, 403);
  assert.equal((await call("PUT", "/admin/albums/permission", { token: admin, json: { key: "bad", uploadMinRank: "" } })).status, 400);
  assert.equal((await call("PUT", "/admin/albums/permission", { token: admin, json: { key: "block:bx", uploadMinRank: "no-such" } })).status, 400);
  // 資料夾設定「不限獎銜」：會員可以上傳，也看得到上傳鈕
  assert.equal((await call("PUT", "/admin/albums/permission", { token: admin, json: { key: "block:bx", uploadMinRank: "none" } })).status, 200);
  assert.equal((await up(stu)).status, 200, "獎銜達標可以上傳");
  const idx = (await call<{ groups: { id: string; folders: { id: string; canEdit: boolean; groupId: string }[] }[] }>("GET", "/albums", { token: stu })).data;
  assert.equal(idx.groups.find((g) => g.id === "block")!.folders[0]!.canEdit, true);
  // 資料夾設成很高的獎銜：優先於類別，會員不能上傳
  await call("PUT", "/admin/albums/permission", { token: admin, json: { key: "group:block", uploadMinRank: "none" } });
  await call("PUT", "/admin/albums/permission", { token: admin, json: { key: "block:bx", uploadMinRank: "diamond" } });
  assert.equal((await up(stu)).status, 403, "資料夾自己的設定優先於類別");
  await call("PUT", "/admin/albums/permission", { token: admin, json: { key: "block:bx", uploadMinRank: null } });
  assert.equal((await up(stu)).status, 200, "清掉資料夾設定＝沿用類別");
  // 資訊總覽與瀏覽數
  const info = await call<{ count: number; bytes: number; uploaders: { name: string; count: number }[]; byViews: { id: string; views: number }[]; effectiveRank: string }>("GET", `/admin/albums/info?id=${encodeURIComponent("block:bx")}`, { token: admin });
  assert.equal(info.status, 200);
  assert.equal(info.data.count, 2);
  assert.equal(info.data.effectiveRank, "none");
  assert.ok(info.data.uploaders.length >= 1);
  assert.equal((await call("GET", `/admin/albums/info?id=${encodeURIComponent("block:bx")}`, { token: stu })).status, 403, "資訊總覽只有超級管理員");
  const first = info.data.byViews[0]!.id;
  await call("POST", `/cover-media/${first}/view`);
  await call("POST", `/cover-media/${first}/view`);
  const after = await call<{ byViews: { id: string; views: number }[] }>("GET", `/admin/albums/info?id=${encodeURIComponent("block:bx")}`, { token: admin });
  assert.equal(after.data.byViews.find((x) => x.id === first)!.views, 2);
  const perms = await call<{ ranks: unknown[]; groups: { id: string }[]; folders: { id: string; uploadMinRank: string | null }[] }>("GET", "/admin/albums/permissions", { token: admin });
  assert.equal(perms.status, 200);
  assert.ok(perms.data.ranks.length > 3 && perms.data.groups.some((g) => g.id === "block"));
});

test("舊照片重新壓縮：只有超級管理員能開始／暫停／看進度，沒有圖片轉檔服務時不開始（業主 2026-11-25）", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on", MEDIA: memR2() };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; bytes?: Uint8Array; json?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { ...(opts.json ? { "content-type": "application/json" } : {}), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: (opts.json ? JSON.stringify(opts.json) : opts.bytes) as unknown as BodyInit | undefined }), env);
    const text = await res.text();
    return { status: res.status, data: (text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { json: { sub } })).data.token;
  const [admin, stu] = await Promise.all([login("demo-admin"), login("demo-student")]);
  await call("PUT", "/admin/cover-media?kind=series&key=R&w=10&h=10", { token: admin, bytes: jpeg });
  assert.equal((await call("GET", "/admin/recompress/status", { token: stu })).status, 403);
  const st = await call<{ total: number; pending: number; job: { running: boolean } }>("GET", "/admin/recompress/status", { token: admin });
  assert.equal(st.status, 200);
  assert.equal(st.data.total, 1);
  assert.equal(st.data.pending, 1);
  assert.equal(st.data.job.running, false);
  assert.equal((await call("POST", "/admin/recompress/start", { token: stu })).status, 403);
  assert.equal((await call("POST", "/admin/recompress/start", { token: admin })).status, 503, "沒有 IMAGES 轉檔服務就不開始");
  assert.equal((await call("POST", "/admin/recompress/stop", { token: admin })).status, 200);
});

test("區塊相簿子資料夾：建立／重新命名／移動／刪除、名稱規則、權限、上傳進資料夾（業主 2026-11-26）", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on", MEDIA: memR2() };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; bytes?: Uint8Array; json?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { ...(opts.json ? { "content-type": "application/json" } : {}), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: (opts.json ? JSON.stringify(opts.json) : opts.bytes) as unknown as BodyInit | undefined }), env);
    const text = await res.text();
    return { status: res.status, data: (text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { json: { sub } })).data.token;
  const [admin, stu] = await Promise.all([login("demo-admin"), login("demo-student")]);
  await db.prepare("INSERT INTO courses (id, title, is_list, status, view_scope, is_public, zone, block_photos) VALUES ('cs', '某課程', 0, 'published', 'all', 1, 'hglobal', 1)").run();
  await db.prepare("INSERT INTO lessons (id, course_id, position, title, kind, media_type) VALUES ('bs', 'cs', 1, '某區塊', 'section', 'demo')").run();
  await db.prepare("DELETE FROM album_permissions").run();
  type Sub = { folders: { id: string; name: string; count: number }[]; uncat: { count: number }; canManage: boolean };
  const up = async (q = "") => (await call<{ id: string }>("PUT", `/admin/cover-media?kind=course&key=bs&w=10&h=10${q}`, { token: admin, bytes: jpeg })).data.id;
  const p1 = await up(), p2 = await up(), p3 = await up();
  const sub0 = (await call<Sub>("GET", "/albums/subfolders?key=bs")).data;
  assert.equal(sub0.folders.length, 0);
  assert.equal(sub0.uncat.count, 3);
  assert.equal(sub0.canManage, false, "訪客不能管理");
  assert.equal((await call("POST", "/admin/album-folders", { token: stu, json: { key: "bs", name: "A" } })).status, 403, "一般會員不能建立");
  assert.equal((await call("POST", "/admin/album-folders", { token: admin, json: { key: "bs", name: "" } })).status, 400);
  assert.equal((await call("POST", "/admin/album-folders", { token: admin, json: { key: "bs", name: "未分類" } })).status, 400);
  assert.equal((await call("POST", "/admin/album-folders", { token: admin, json: { key: "bs", name: "超過二十個字".repeat(4) } })).status, 400);
  assert.equal((await call("POST", "/admin/album-folders", { token: admin, json: { key: "cs", name: "A" } })).status, 400, "只有區塊相簿才有資料夾");
  const f1 = (await call<{ id: string }>("POST", "/admin/album-folders", { token: admin, json: { key: "bs", name: "產品介紹" } })).data.id;
  const f2 = (await call<{ id: string }>("POST", "/admin/album-folders", { token: admin, json: { key: "bs", name: "活動照片" } })).data.id;
  assert.equal((await call("POST", "/admin/album-folders", { token: admin, json: { key: "bs", name: "產品介紹" } })).status, 409, "同名不行");
  // 移動、計數與排序（張數多到少）
  const m = await call<Sub>("POST", "/admin/album-folders/move", { token: admin, json: { key: "bs", ids: [p1, p2], folderId: f2 } });
  assert.deepEqual(m.data.folders.map((f) => [f.name, f.count]), [["活動照片", 2], ["產品介紹", 0]]);
  assert.equal(m.data.uncat.count, 1);
  assert.equal((await call("POST", "/admin/album-folders/move", { token: stu, json: { key: "bs", ids: [p3], folderId: f1 } })).status, 403);
  assert.equal((await call("POST", "/admin/album-folders/move", { token: admin, json: { key: "bs", ids: [p3], folderId: "nope" } })).status, 404);
  // 上傳進目前資料夾；照片項目帶 folderId
  const p4 = await up(`&folder=${f1}`);
  const items = (await call<{ id: string; folderId?: string }[]>("GET", "/cover-media?kind=course&key=bs")).data;
  assert.equal(items.find((x) => x.id === p4)!.folderId, f1);
  assert.equal(items.find((x) => x.id === p3)!.folderId, undefined, "未分類沒有 folderId");
  // 重新命名
  assert.equal((await call("PUT", `/admin/album-folders/${f1}`, { token: admin, json: { name: "活動照片" } })).status, 409);
  const rn = await call<Sub>("PUT", `/admin/album-folders/${f1}`, { token: admin, json: { name: "產品" } });
  assert.ok(rn.data.folders.some((f) => f.name === "產品"));
  // 刪除：照片回到未分類，不刪照片
  const del = await call<Sub>("DELETE", `/admin/album-folders/${f2}`, { token: admin });
  assert.equal(del.data.folders.length, 1);
  assert.equal(del.data.uncat.count, 3, "2 張回到未分類＋原本 1 張");
  assert.equal((await call<unknown[]>("GET", "/cover-media?kind=course&key=bs")).data.length, 4, "照片都還在");
  // 獎銜達標者可管理（上傳權限設定）
  await call("PUT", "/admin/albums/permission", { token: admin, json: { key: "block:bs", uploadMinRank: "none" } });
  assert.equal((await call("POST", "/admin/album-folders", { token: stu, json: { key: "bs", name: "會員的" } })).status, 200);
  assert.equal((await call<Sub>("GET", "/albums/subfolders?key=bs", { token: stu })).data.canManage, true);
});

test("文字辨識：拆掉 JSON 殼並去掉卡住的重複行", async () => {
  const { cleanOcrText } = await import("../src/edm-structure.ts");
  const bad = '{"text":"\n' + "title:\n".repeat(40) + '生活層次\n從心觸動\n生活層次';
  assert.equal(cleanOcrText(bad), "生活層次\n從心觸動");
});

test("AI 回傳物件（Llama 4 Scout 的 JSON 回應）也能轉成文字並解析", async () => {
  const { aiResponseText } = await import("../src/ai-image.ts");
  const { parseVision } = await import("../src/edm-vision.ts");
  const t = aiResponseText({ response: { event_date: "null", text: "好食光\n11/15(日)" } });
  assert.equal(typeof t, "string");
  assert.match(parseVision(t).text, /好食光/);
  assert.equal(aiResponseText({ choices: [{ message: { content: "abc" } }] }), "abc");
});
