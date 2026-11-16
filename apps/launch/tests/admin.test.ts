import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail, CourseSummary, Playback } from "../src/contract.ts";
import type { Env, R2Bucket } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

/** 記憶體版 R2（測試用）。 */
function fakeR2(): R2Bucket & { objects: Map<string, { data: Uint8Array; type?: string }> } {
  const objects = new Map<string, { data: Uint8Array; type?: string }>();
  const uploads = new Map<string, { key: string; type?: string; parts: Map<number, Uint8Array> }>();
  return {
    objects,
    async head(key) {
      const o = objects.get(key);
      return o ? { size: o.data.byteLength, httpMetadata: { contentType: o.type } } : null;
    },
    async get(key, opts) {
      const o = objects.get(key);
      if (!o) return null;
      const r = opts?.range ? o.data.slice(opts.range.offset, opts.range.offset + opts.range.length) : o.data;
      return { size: o.data.byteLength, httpMetadata: { contentType: o.type }, body: new Response(r as Uint8Array<ArrayBuffer>).body! };
    },
    async delete(key) {
      objects.delete(key);
    },
    async put(key, value, opts) {
      objects.set(key, { data: new Uint8Array(value), type: opts?.httpMetadata?.contentType });
    },
    async createMultipartUpload(key, opts) {
      const id = `u${uploads.size + 1}`;
      uploads.set(id, { key, type: opts?.httpMetadata?.contentType, parts: new Map() });
      return { uploadId: id };
    },
    resumeMultipartUpload(key, uploadId) {
      const u = uploads.get(uploadId)!;
      assert.equal(u.key, key);
      return {
        async uploadPart(n, value) {
          u.parts.set(n, new Uint8Array(value));
          return { partNumber: n, etag: `e${n}` };
        },
        async complete(parts) {
          const chunks = parts.sort((a, b) => a.partNumber - b.partNumber).map((p) => u.parts.get(p.partNumber)!);
          const data = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
          let off = 0;
          for (const c of chunks) {
            data.set(c, off);
            off += c.byteLength;
          }
          objects.set(key, { data, type: u.type });
        },
      };
    },
  };
}

function setup(extra: Partial<Env> = {}) {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on", ...extra };
  const raw = (method: string, path: string, opts: { token?: string; body?: unknown; bytes?: Uint8Array; headers?: Record<string, string> } = {}) =>
    handleApi(
      new Request(`https://learn.test${path.startsWith("/api") ? path : `/api/v2${path}`}`, {
        method,
        headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
        body: (opts.bytes as Uint8Array<ArrayBuffer> | undefined) ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
      }),
      env,
    );
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: Parameters<typeof raw>[2] = {}) => {
    const res = await raw(method, path, opts);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  return { env, raw, call, login };
}

test("管理員新增、修改、刪除課程；新課程預設未上架；學員不可操作", async () => {
  const { call, login } = setup();
  const admin = await login("demo-admin");
  const student = await login("demo-student");
  assert.equal((await call("POST", "/admin/courses", { token: student, body: { title: "x" } })).status, 403);
  assert.equal((await call("POST", "/admin/courses", { token: admin, body: { title: " " } })).status, 400);
  const created = await call<CourseDetail>("POST", "/admin/courses", {
    token: admin,
    body: { title: "銅章會議", subtitle: "每月一次", teacher: "寰宇總部", category: "系列課程", priceTwd: 50, minRankCode: "r15", theme: "gold", description: "介紹" },
  });
  assert.equal(created.status, 200);
  const c = created.data;
  assert.equal(c.status, "draft");
  assert.equal(c.description, "介紹");
  assert.equal(c.minRank.code, "r15");
  assert.equal(c.lessons.length, 1, "自動建立第 1 堂");
  assert.equal((await call("GET", `/courses/${c.id}`, { token: student })).status, 404, "未上架學員看不到");
  const patched = await call<CourseDetail>("PATCH", `/admin/courses/${c.id}`, { token: admin, body: { priceTwd: 0, status: "published", title: "銅章會議（新）" } });
  assert.equal(patched.data.title, "銅章會議（新）");
  assert.equal(patched.data.free, true, "付費可改免費");
  assert.equal((await call("PATCH", `/admin/courses/${c.id}`, { token: admin, body: { priceTwd: -1 } })).status, 400);
  // 有人報名後不能刪，只能下架
  const silver = await login("demo-silver");
  await call("PATCH", `/admin/courses/${c.id}`, { token: admin, body: { minRankCode: "none" } });
  assert.equal((await call("POST", "/orders", { token: silver, body: { courseIds: [c.id] } })).status, 200);
  assert.equal((await call("DELETE", `/admin/courses/${c.id}`, { token: admin })).status, 409);
  const empty = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "暫存" } })).data;
  assert.equal((await call("DELETE", `/admin/courses/${empty.id}`, { token: admin })).status, 200);
  assert.equal((await call("GET", `/courses/${empty.id}`, { token: admin })).status, 404);
});

test("章節：新增、改名、排序、刪除後自動重新編號", async () => {
  const { call, login } = setup();
  const admin = await login("demo-admin");
  let d = (await call<CourseDetail>("POST", "/admin/courses/start/lessons", { token: admin, body: { title: "第五堂" } })).data;
  assert.deepEqual(d.lessons.map((l) => l.position), [1, 2, 3, 4, 5]);
  const fifth = d.lessons[4].id;
  await call("PATCH", `/admin/lessons/${fifth}`, { token: admin, body: { title: "加映場" } });
  const order = [fifth, ...d.lessons.slice(0, 4).map((l) => l.id)];
  d = (await call<CourseDetail>("POST", "/admin/courses/start/lessons/order", { token: admin, body: { ids: order } })).data;
  assert.equal(d.lessons[0].title, "加映場");
  assert.equal((await call("POST", "/admin/courses/start/lessons/order", { token: admin, body: { ids: order.slice(1) } })).status, 400);
  await call("DELETE", `/admin/lessons/${d.lessons[1].id}`, { token: admin });
  d = (await call<CourseDetail>("GET", "/courses/start", { token: admin })).data;
  assert.deepEqual(d.lessons.map((l) => l.position), [1, 2, 3, 4]);
});

test("時間軸分段：設定時分秒區間，長度自動計算，播放資訊帶區間", async () => {
  const { call, login } = setup();
  const admin = await login("demo-admin");
  const student = await login("demo-student");
  const id = "start-foundation";
  assert.equal((await call("PATCH", `/admin/lessons/${id}`, { token: admin, body: { startSeconds: 600, endSeconds: 300 } })).status, 400, "結束需晚於開始");
  await call("PATCH", `/admin/lessons/${id}`, { token: admin, body: { mediaType: "youtube", mediaRef: "dQw4w9WgXcQ", startSeconds: 3725, endSeconds: 5025 } });
  const d = (await call<CourseDetail>("GET", "/courses/start", { token: student })).data;
  const l = d.lessons.find((x) => x.id === id)!;
  assert.equal(l.minutes, 22, "1300 秒 → 22 分鐘");
  assert.deepEqual([l.start, l.end], [3725, 5025]);
  await call("POST", "/orders", { token: student, body: { courseIds: ["start"] } });
  const p = (await call<Playback>("GET", `/courses/start/lessons/${id}/playback`, { token: student })).data;
  assert.deepEqual(p, { kind: "youtube", videoId: "dQw4w9WgXcQ", start: 3725, end: 5025 });
  await call("PATCH", `/admin/lessons/${id}`, { token: admin, body: { startSeconds: null, endSeconds: null } });
  assert.deepEqual((await call<Playback>("GET", `/courses/start/lessons/${id}/playback`, { token: student })).data, { kind: "youtube", videoId: "dQw4w9WgXcQ", start: null, end: null });
});

test("音檔：分段上傳到 R2、只有開通學員拿得到簽名網址、支援 Range、竄改簽名被拒", async () => {
  const r2 = fakeR2();
  const noStorage = setup();
  const a0 = await noStorage.login("demo-admin");
  assert.equal((await noStorage.call("POST", "/admin/lessons/start-review/audio/start", { token: a0, body: { fileName: "a.mp3", contentType: "audio/mpeg", size: 10 } })).status, 503);

  const { call, raw, login } = setup({ MEDIA: r2, MEDIA_URL_SECRET: "test-secret" });
  const admin = await login("demo-admin");
  const student = await login("demo-student");
  assert.equal((await call("POST", "/admin/lessons/start-review/audio/start", { token: admin, body: { fileName: "a.exe", contentType: "application/x-msdownload", size: 10 } })).status, 400);
  const { key, uploadId } = (await call<{ key: string; uploadId: string }>("POST", "/admin/lessons/start-review/audio/start", { token: admin, body: { fileName: "第4堂.MP3", contentType: "audio/mpeg", size: 10 } })).data;
  assert.match(key, /^audio\/start-review\/[\w-]+\.mp3$/);
  const parts = [];
  for (const [n, bytes] of [[1, [0, 1, 2, 3, 4]], [2, [5, 6, 7, 8, 9]]] as const) {
    const r = await call<{ partNumber: number; etag: string }>("PUT", `/admin/lessons/start-review/audio/part?key=${encodeURIComponent(key)}&uploadId=${uploadId}&part=${n}`, { token: admin, bytes: new Uint8Array(bytes) });
    parts.push(r.data);
  }
  assert.equal((await call("PUT", `/admin/lessons/start-review/audio/part?key=audio/other/x.mp3&uploadId=${uploadId}&part=1`, { token: admin, bytes: new Uint8Array([1]) })).status, 400, "不能寫到別堂");
  assert.equal((await call("POST", "/admin/lessons/start-review/audio/complete", { token: admin, body: { key, uploadId, parts, durationSeconds: 125 } })).status, 200);
  const lesson = (await call<CourseDetail>("GET", "/courses/start", { token: admin })).data.lessons.find((l) => l.id === "start-review")!;
  assert.equal(lesson.kind, "audio");
  assert.equal(lesson.minutes, 3);

  await call("PATCH", "/admin/courses/start", { token: admin, body: { priceTba: true } }); // 費用尚未公布：免費課程的「符合資格直接看」不適用
  assert.equal((await call("GET", "/courses/start/lessons/start-review/playback", { token: student })).status, 403, "未報名");
  await call("PATCH", "/admin/courses/start", { token: admin, body: { priceTba: false } });
  await call("POST", "/orders", { token: student, body: { courseIds: ["start"] } });
  const p = (await call<{ kind: string; url: string }>("GET", "/courses/start/lessons/start-review/playback", { token: student })).data;
  assert.equal(p.kind, "audio");
  const full = await raw("GET", p.url);
  assert.equal(full.status, 200);
  assert.deepEqual([...new Uint8Array(await full.arrayBuffer())], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const part = await raw("GET", p.url, { headers: { range: "bytes=2-4" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 2-4/10");
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [2, 3, 4]);
  assert.equal((await raw("GET", p.url.replace(/s=(.)/, (_m, ch) => `s=${ch === "X" ? "Y" : "X"}`))).status, 403);
  assert.equal((await raw("GET", p.url.replace(/e=\d+/, "e=1"))).status, 403, "過期");

  // 換回影片來源時刪除舊音檔
  await call("PATCH", "/admin/lessons/start-review", { token: admin, body: { mediaType: "demo" } });
  assert.equal(r2.objects.size, 0);
});

test("有人報名的課程只能「下架封存」（學員照常上課、可還原）；沒人報名（或只有已退回）才真的刪除", async () => {
  const { env, call, login } = setup({ MEDIA: fakeR2(), MEDIA_URL_SECRET: "s" });
  const [admin, s1, s2, other] = await Promise.all(["demo-admin", "demo-student", "demo-silver", "demo-desk"].map(login));
  const mk = async (title: string) => (await call<{ id: string }>("POST", "/admin/courses", { token: admin, body: { title, priceTwd: 100 } })).data.id;
  const [a, b] = [await mk("要封存的課"), await mk("留下的課")];
  await call("PATCH", `/admin/courses/${a}`, { token: admin, body: { status: "published", minRank: "none" } });
  await call("PATCH", `/admin/courses/${b}`, { token: admin, body: { status: "published", minRank: "none" } });
  const [o1] = (await call<{ id: string }[]>("POST", "/orders", { token: s1, body: { courseIds: [a] } })).data;
  await call<{ id: string }[]>("POST", "/orders", { token: s2, body: { courseIds: [a] } });
  await call("POST", `/admin/orders/${o1!.id}/review`, { token: admin, body: { action: "paid", paidTwd: 100 } });

  type Impact = { registrations: number; pending: number; opened: number; students: number; paidTwd: number; title: string };
  const impact = (await call<Impact>("GET", `/admin/courses/${a}/delete-impact`, { token: admin })).data;
  assert.deepEqual([impact.title, impact.registrations, impact.pending, impact.opened, impact.students, impact.paidTwd], ["要封存的課", 2, 1, 1, 1, 100]);
  assert.equal((await call("GET", `/admin/courses/${a}/delete-impact`, { token: s1 })).status, 403);
  const detail = (await call<CourseDetail>("GET", `/courses/${a}`, { token: admin })).data;
  assert.equal(detail.admin?.registrations, 2, "已開通＋待審核");

  // 有人報名：誰都不能永久刪除（總部也一樣），只能下架封存
  assert.equal((await call("DELETE", `/admin/courses/${a}`, { token: admin, body: { confirm: "YES" } })).status, 409);
  assert.equal((await call("DELETE", `/admin/courses/${a}`, { token: s1 })).status, 403, "學員不能刪");
  assert.equal((await call("PATCH", `/admin/courses/${a}`, { token: s1, body: { status: "archived" } })).status, 403);
  assert.equal((await call("PATCH", `/admin/courses/${a}`, { token: admin, body: { status: "archived" } })).status, 200);

  // 封存後：已繳費與審核中的學員照常看得到（學習中），其他人看不到、也不在全部課程裡
  const list1 = (await call<CourseSummary[]>("GET", "/courses", { token: s1 })).data;
  assert.equal(list1.find((c) => c.id === a)?.status, "archived");
  assert.equal((await call("GET", `/courses/${a}`, { token: s1 })).status, 200);
  assert.equal((await call("GET", `/courses/${a}`, { token: s2 })).status, 200);
  assert.equal((await call("GET", `/courses/${a}`, { token: other })).status, 404);
  assert.equal((await call<CourseSummary[]>("GET", "/courses", { token: other })).data.some((c) => c.id === a), false);
  assert.equal((await call("POST", "/orders", { token: other, body: { courseIds: [a] } })).status >= 400, true, "封存的課程不能再報名");
  const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())!.n;
  assert.equal(await count(`SELECT COUNT(*) AS n FROM orders WHERE id = '${o1!.id}'`), 1, "報名紀錄保留");

  // 還原
  assert.equal((await call("PATCH", `/admin/courses/${a}`, { token: admin, body: { status: "published" } })).status, 200);
  assert.equal((await call<CourseSummary[]>("GET", "/courses", { token: other })).data.some((c) => c.id === a), true);

  // 只有已退回的報名：可以真的刪除，退回的紀錄一併清掉；別門課不受影響
  const c = await mk("只有退回");
  await call("PATCH", `/admin/courses/${c}`, { token: admin, body: { status: "published" } });
  const [o3] = (await call<{ id: string }[]>("POST", "/orders", { token: s2, body: { courseIds: [c] } })).data;
  assert.equal((await call("POST", `/admin/orders/${o3!.id}/review`, { token: admin, body: { action: "reject", reasonCode: "unpaid" } })).status, 200);
  assert.equal((await call("DELETE", `/admin/courses/${c}`, { token: admin })).status, 200);
  assert.equal(await count(`SELECT COUNT(*) AS n FROM orders WHERE id = '${o3!.id}'`), 0);
  assert.equal(await count(`SELECT COUNT(*) AS n FROM courses WHERE id = '${b}'`), 1);
  const log = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'course.delete' AND target_id = ?").bind(c).first<{ detail: string }>();
  assert.equal(JSON.parse(log!.detail).registrations, 1, "稽核紀錄留下刪除統計");

  // 沒人報名的課程照舊可直接刪除
  const d = await mk("沒人報名");
  assert.equal((await call("DELETE", `/admin/courses/${d}`, { token: admin })).status, 200);
});

test("EDM 與 16:9 封面（從 EDM 裁切）：公開網址、權限依中心、壓縮後格式檢查、換圖刪舊檔、刪課程時清檔", async () => {
  const r2 = fakeR2();
  const { env, call, raw, login } = setup({ MEDIA: r2, MEDIA_URL_SECRET: "s" });
  const [admin, pres, student] = await Promise.all(["demo-admin", "demo-president", "demo-student"].map(login));
  const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: n + 10 }, (_, i) => i % 256)]);
  const put = (token: string, path: string, bytes: Uint8Array) => call<Record<string, unknown>>("PUT", path, { token, bytes });

  // 底圖圖庫功能已移除：路徑不存在
  assert.equal((await call("GET", "/admin/cover-backgrounds", { token: admin })).status, 404);

  // 課程：主辦單位是會長的中心，會長才能編輯 EDM；別的課程、學員不行
  await call("PATCH", "/admin/courses/start", { token: admin, body: { hostUnit: "台北中心" } });
  assert.equal((await put(pres, "/admin/courses/start/edm", jpeg(100))).status, 200);
  assert.equal((await put(pres, "/admin/courses/talk/edm", jpeg(100))).status, 403, "不是自己中心的課程");
  assert.equal((await put(student, "/admin/courses/start/edm", jpeg(10))).status, 403);
  assert.equal((await put(admin, "/admin/courses/start/edm", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]))).status, 400, "不是圖片");
  assert.equal((await put(admin, "/admin/courses/start/edm", new Uint8Array(9 * 1024 * 1024).fill(1)).catch(() => ({ status: 0 }))).status === 200, false);

  // 課程摘要帶公開網址，未登入也能讀圖；舊檔已被取代而刪除
  const sum = (await call<{ id: string; edmUrl: string | null; coverUrl: string | null }[]>("GET", "/courses", { token: student })).data.find((c) => c.id === "start")!;
  assert.ok(decodeURIComponent(sum.edmUrl ?? "").startsWith("/api/v2/media/pub?k=edm/start/"));
  assert.equal(sum.coverUrl, null, "沒有裁切封面時為 null");
  const img = await raw("GET", sum.edmUrl!);
  assert.deepEqual([img.status, img.headers.get("content-type"), img.headers.get("cache-control")?.includes("immutable")], [200, "image/jpeg", true]);
  assert.equal((await raw("GET", "/api/v2/media/pub?k=edm/start/not-used.jpg")).status, 404, "沒在使用的檔案不提供");
  await put(pres, "/admin/courses/start/edm", jpeg(120));
  assert.equal([...r2.objects.keys()].filter((k) => k.startsWith("edm/start/")).length, 1, "舊 EDM 已刪");
  // 16:9 封面（從 EDM 裁切）：權限同 EDM、換圖刪舊檔、課程摘要帶網址；EDM 預設位置 0～1
  assert.equal((await put(student, "/admin/courses/start/cover", jpeg(10))).status, 403);
  assert.equal((await put(pres, "/admin/courses/start/cover", jpeg(40))).status, 200);
  await put(pres, "/admin/courses/start/cover", jpeg(50));
  assert.equal([...r2.objects.keys()].filter((k) => k.startsWith("cover/start/")).length, 1, "舊封面已刪");
  assert.equal((await call("PATCH", "/admin/courses/start", { token: admin, body: { edmViewY: 0.35 } })).status, 200);
  assert.equal((await call("PATCH", "/admin/courses/start", { token: admin, body: { edmViewY: 2 } })).status, 400);
  const sum2 = (await call<{ id: string; coverUrl: string | null; edmViewY: number }[]>("GET", "/courses", { token: student })).data.find((c) => c.id === "start")!;
  assert.ok(decodeURIComponent(sum2.coverUrl ?? "").startsWith("/api/v2/media/pub?k=cover/start/"));
  assert.equal(sum2.edmViewY, 0.35);
  // 封面框與預設停留位置永遠同步：給 coverRect 時，預設位置＝封面框上緣（不接受另外指定）
  const cr = await call("PATCH", "/admin/courses/start", { token: admin, body: { coverRect: { x: 0, y: 0.2345678, w: 1 }, edmViewY: 0.9 } });
  assert.equal(cr.status, 200);
  const sum3 = (await call<{ id: string; edmViewY: number; coverRect: { x: number; y: number; w: number } | null }[]>("GET", "/courses", { token: student })).data.find((c) => c.id === "start")!;
  assert.deepEqual(sum3.coverRect, { x: 0, y: 0.2346, w: 1 });
  assert.equal(sum3.edmViewY, 0.2346);
  assert.equal((await call("PATCH", "/admin/courses/start", { token: admin, body: { coverRect: { x: 0.5, y: 0.1, w: 0.9 } } })).status, 400); // 超出圖片範圍
  // 之後只改預設位置：封面框作廢（避免兩者不一致）
  await call("PATCH", "/admin/courses/start", { token: admin, body: { edmViewY: 0.4 } });
  const sum4 = (await call<{ id: string; edmViewY: number; coverRect: unknown }[]>("GET", "/courses", { token: student })).data.find((c) => c.id === "start")!;
  assert.equal(sum4.coverRect, null);
  assert.equal(sum4.edmViewY, 0.4);
  assert.equal((await raw("GET", sum2.coverUrl!)).status, 200);
  assert.equal((await call("DELETE", "/admin/courses/start/cover", { token: pres })).status, 200);
  assert.equal((await call("DELETE", "/admin/courses/start/edm", { token: pres })).status, 200);
  assert.equal([...r2.objects.keys()].filter((k) => k.startsWith("edm/start/")).length, 0);

  // 刪除課程時一併刪 EDM
  const created = (await call<{ id: string }>("POST", "/admin/courses", { token: admin, body: { title: "有海報的課" } })).data.id;
  await put(admin, `/admin/courses/${created}/edm`, jpeg(30));
  assert.ok([...r2.objects.keys()].some((k) => k.startsWith(`edm/${created}/`)));
  await call("DELETE", `/admin/courses/${created}`, { token: admin });
  assert.equal([...r2.objects.keys()].some((k) => k.startsWith(`edm/${created}/`)), false);
  void env;
});

test("跑馬燈公告：公開只看啟用中的、管理員（超級管理員／秘書）才能新增修改排序刪除", async () => {
  const { call, login } = setup();
  const [admin, student, pres] = await Promise.all(["demo-admin", "demo-student", "demo-president"].map(login));
  type A = { id: string; text: string; enabled: boolean };
  assert.deepEqual((await call<A[]>("GET", "/announcements")).data, [], "沒有公告時是空的（未登入也能讀）");
  assert.equal((await call("POST", "/admin/announcements", { token: student, body: { text: "x" } })).status, 403);
  assert.equal((await call("POST", "/admin/announcements", { token: pres, body: { text: "x" } })).status, 403, "會長目前不能管理");
  assert.equal((await call("POST", "/admin/announcements", { token: admin, body: { text: "   " } })).status, 400);
  const a = (await call<A>("POST", "/admin/announcements", { token: admin, body: { text: "第一則" } })).data;
  const b = (await call<A>("POST", "/admin/announcements", { token: admin, body: { text: "第二則".repeat(60) } })).data;
  assert.equal(b.text.length, 120, "超過 120 字會截斷");
  const c = (await call<A>("POST", "/admin/announcements", { token: admin, body: { text: "第三則" } })).data;
  assert.deepEqual((await call<A[]>("GET", "/announcements")).data.map((x) => x.id), [a.id, b.id, c.id]);

  await call("PATCH", `/admin/announcements/${b.id}`, { token: admin, body: { enabled: false } });
  assert.deepEqual((await call<A[]>("GET", "/announcements")).data.map((x) => x.id), [a.id, c.id], "停用的不顯示");
  assert.equal((await call<A[]>("GET", "/admin/announcements", { token: admin })).data.length, 3, "管理員看得到全部");
  assert.equal((await call("GET", "/admin/announcements", { token: student })).status, 403);

  await call("POST", "/admin/announcements/order", { token: admin, body: { ids: [c.id, b.id, a.id] } });
  assert.deepEqual((await call<A[]>("GET", "/announcements")).data.map((x) => x.text), ["第三則", "第一則"]);
  await call("PATCH", `/admin/announcements/${a.id}`, { token: admin, body: { text: "改過的第一則" } });
  assert.equal((await call<A[]>("GET", "/announcements")).data.at(-1)!.text, "改過的第一則");
  assert.equal((await call("DELETE", `/admin/announcements/${c.id}`, { token: admin })).status, 200);
  assert.equal((await call("DELETE", `/admin/announcements/${c.id}`, { token: admin })).status, 404);
  assert.equal((await call("PATCH", `/admin/announcements/${a.id}`, { token: admin, body: {} })).status, 400);
});

test("學習金句：內建 20 句、隨機取一則、只有超級管理員可新增修改刪除（秘書不行）", async () => {
  const { call, login } = setup();
  const [admin, student] = await Promise.all(["demo-admin", "demo-student"].map(login));
  type Q = { id: string; text: string };
  const list = (await call<Q[]>("GET", "/admin/quotes", { token: admin })).data;
  assert.equal(list.length, 20, "初始 20 句");
  assert.ok(list.some((q) => q.text.startsWith("經驗是最好的老師")));
  const r = (await call<{ text: string | null }>("GET", "/quotes/random")).data;
  assert.ok(r.text && list.some((q) => q.text === r.text), "隨機取一則（未登入也可）");
  assert.equal((await call("GET", "/admin/quotes", { token: student })).status, 403);
  assert.equal((await call("PATCH", `/admin/quotes/${list[0].id}`, { token: student, body: { text: "x" } })).status, 403);
  assert.equal((await call("PATCH", `/admin/quotes/${list[0].id}`, { token: admin, body: { text: "改過的金句" } })).status, 200);
  assert.equal((await call<Q[]>("GET", "/admin/quotes", { token: admin })).data.some((q) => q.text === "改過的金句"), true);
  assert.equal((await call("PATCH", "/admin/quotes/nope", { token: admin, body: { text: "x" } })).status, 404);
  assert.equal((await call("DELETE", `/admin/quotes/${list[1].id}`, { token: admin })).status, 200);
});

test("系列專屬 EDM：只有超級管理員上傳、課程摘要帶網址、換圖刪舊檔、改名跟著走、刪除系列清檔", async () => {
  const r2 = fakeR2();
  const { call, raw, login } = setup({ MEDIA: r2, MEDIA_URL_SECRET: "s" });
  const [admin, student] = await Promise.all(["demo-admin", "demo-student"].map(login));
  const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: n + 10 }, (_, i) => i % 256)]);
  const put = (token: string, series: string, bytes: Uint8Array) => call<Record<string, unknown>>("PUT", `/admin/series/edm?series=${encodeURIComponent(series)}`, { token, bytes });
  await call("PATCH", "/admin/courses/start", { token: admin, body: { series: "新手系列" } });
  assert.equal((await put(student, "新手系列", jpeg(10))).status, 403);
  assert.equal((await put(admin, "新手系列", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]))).status, 400, "不是圖片");
  assert.equal((await put(admin, "新手系列", jpeg(100))).status, 200);
  await put(admin, "新手系列", jpeg(120));
  assert.equal([...r2.objects.keys()].filter((k) => k.startsWith("series/")).length, 1, "舊圖已刪");
  const sum = (await call<{ id: string; seriesEdmUrl: string | null }[]>("GET", "/courses", { token: student })).data.find((c) => c.id === "start")!;
  assert.ok(decodeURIComponent(sum.seriesEdmUrl ?? "").startsWith("/api/v2/media/pub?k=series/"));
  assert.equal((await raw("GET", sum.seriesEdmUrl!)).status, 200, "公開可讀");
  // 改名：圖跟著走
  await call("PATCH", "/admin/keywords", { token: admin, body: { kind: "series", from: "新手系列", to: "新手入門系列" } });
  const renamed = (await call<{ id: string; series: string; seriesEdmUrl: string | null }[]>("GET", "/courses", { token: student })).data.find((c) => c.id === "start")!;
  assert.equal(renamed.series, "新手入門系列");
  assert.ok(renamed.seriesEdmUrl);
  const kw = (await call<{ series: { value: string; edmUrl?: string | null }[] }>("GET", "/admin/keywords", { token: admin })).data;
  assert.ok(kw.series.find((k) => k.value === "新手入門系列")?.edmUrl);
  // 刪除系列：圖也刪
  await call("POST", "/admin/keywords/remove", { token: admin, body: { kind: "series", value: "新手入門系列" } });
  assert.equal([...r2.objects.keys()].filter((k) => k.startsWith("series/")).length, 0);
  // 只移除圖
  await call("PATCH", "/admin/courses/start", { token: admin, body: { series: "A 系列" } });
  await put(admin, "A 系列", jpeg(30));
  assert.equal((await call("DELETE", `/admin/series/edm?series=${encodeURIComponent("A 系列")}`, { token: admin })).status, 200);
  assert.equal([...r2.objects.keys()].filter((k) => k.startsWith("series/")).length, 0);
});
