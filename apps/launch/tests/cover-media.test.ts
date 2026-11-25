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
