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
