import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env, R2Bucket } from "../src/d1.ts";
import { PART_BYTES, revokeLegacyDriveLink } from "../src/material-files.ts";
import { createTestDb } from "./sqlite-d1.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** 記憶體版 R2（含分段上傳與 Range）。 */
function memR2() {
  const store = new Map<string, { data: Uint8Array; type?: string }>();
  const uploads = new Map<string, { key: string; type?: string; parts: Map<number, Uint8Array> }>();
  let partCalls = 0;
  const bucket = {
    store,
    get partCalls() {
      return partCalls;
    },
    async head(k: string) {
      const o = store.get(k);
      return o ? { size: o.data.byteLength, httpMetadata: { contentType: o.type } } : null;
    },
    async get(k: string, opts?: { range?: { offset: number; length: number } }) {
      const o = store.get(k);
      if (!o) return null;
      const data = opts?.range ? o.data.slice(opts.range.offset, opts.range.offset + opts.range.length) : o.data;
      return { size: o.data.byteLength, httpMetadata: { contentType: o.type }, body: new Response(data as Uint8Array<ArrayBuffer>).body! };
    },
    async delete(k: string) {
      store.delete(k);
    },
    async list() {
      return { objects: [...store].map(([key, o]) => ({ key, size: o.data.byteLength })), truncated: false };
    },
    async put(k: string, v: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
      store.set(k, { data: new Uint8Array(v), type: opts?.httpMetadata?.contentType });
    },
    async createMultipartUpload(key: string, opts?: { httpMetadata?: { contentType?: string } }) {
      const uploadId = `u${uploads.size + 1}`;
      uploads.set(uploadId, { key, type: opts?.httpMetadata?.contentType, parts: new Map() });
      return { uploadId };
    },
    resumeMultipartUpload(_key: string, uploadId: string) {
      const u = uploads.get(uploadId)!;
      return {
        async uploadPart(n: number, v: ArrayBuffer) {
          partCalls++;
          u.parts.set(n, new Uint8Array(v));
          return { partNumber: n, etag: `e${n}` };
        },
        async complete(parts: { partNumber: number }[]) {
          const all = parts.map((p) => u.parts.get(p.partNumber)!);
          const out = new Uint8Array(all.reduce((n, a) => n + a.byteLength, 0));
          let off = 0;
          for (const a of all) (out.set(a, off), (off += a.byteLength));
          store.set(u.key, { data: out, type: u.type });
        },
        async abort() {
          uploads.delete(uploadId);
        },
      };
    },
  };
  return bucket as unknown as R2Bucket & { store: typeof store; partCalls: number };
}

function harness(extra: Partial<Env> = {}) {
  const db = createTestDb();
  const r2 = memR2();
  const env: Env = { DB: db, DEMO_LOGIN: "on", MEDIA: r2, ...extra };
  const call = async <T = Record<string, any>,>(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    const ct = res.headers.get("content-type") ?? "";
    return { status: res.status, res, data: (ct.includes("json") ? ((await res.clone().json()) as T) : (null as T)), text: ct.includes("json") ? "" : await res.clone().text() };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  return { db, r2, env, call, login };
}

/** 假的 Google 雲端硬碟（使用者自己的）：meta 與內容。 */
function fakeUserDrive(files: Record<string, { name: string; mimeType: string; size?: number; body: Uint8Array; trashed?: boolean }>, opts: { badToken?: boolean } = {}) {
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push(`${init?.method ?? "GET"} ${url}`);
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) return new Response("", { status: 200 });
    const m = /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([\w-]+)(\/export)?(\?.*)?$/.exec(url);
    if (!m) return new Response("{}", { status: 404 });
    if (opts.badToken || new Headers(init?.headers).get("authorization") !== "Bearer user-token-abcdefghijklmnop") return new Response("{}", { status: 401 });
    const f = files[m[1]!];
    if (!f) return new Response("{}", { status: 404 });
    if (m[2] || url.includes("alt=media")) return new Response(f.body as Uint8Array<ArrayBuffer>, { status: 200 });
    return new Response(JSON.stringify({ id: m[1], name: f.name, mimeType: f.mimeType, size: f.size !== undefined ? String(f.size) : String(f.body.byteLength), trashed: !!f.trashed }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return seen;
}
const TOKEN = "user-token-abcdefghijklmnop";
const bytes = (n: number, v = 7) => new Uint8Array(n).fill(v);

test("教材檔案下載：權限檢查＋一次性連結＋續傳＋每日上限；設定只有超級管理員能改", async () => {
  const { db, r2, call, login } = harness();
  const admin = await login("demo-admin");
  const student = await login("demo-student");
  const list = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { isList: true, title: "清單" } })).data;
  const paid = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "付費課", teacher: "王", priceTwd: 500, status: "published" } })).data;
  const seed = async (courseId: string, id: string) => {
    r2.store.set(`file/${courseId}/${id}/a.pdf`, { data: new Uint8Array([1, 2, 3, 4, 5]), type: "application/pdf" });
    await db.prepare("INSERT INTO lessons (id, course_id, position, title, sharer, sharer_rank, sharer_title, duration_minutes, media_type, auto_cover, kind) VALUES (?, ?, 99, '簡報', '', '', '', 0, 'demo', 0, 'material')").bind(`l-${id}`, courseId).run();
    await db.prepare("INSERT INTO lesson_attachments (id, lesson_id, course_id, name, r2_key, size, content_type, kind, att_type, created_by) VALUES (?, ?, ?, 'a.pdf', ?, 5, 'application/pdf', 'file', 'pdf', 'demo-admin')").bind(id, `l-${id}`, courseId, `file/${courseId}/${id}/a.pdf`).run();
  };
  await seed(list.id, "att1");
  await seed(paid.id, "att2");

  assert.equal((await call("POST", "/materials/att1/ticket")).status, 401);
  const t = await call("POST", "/materials/att1/ticket", { token: student });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  const path = new URL(t.data.url).pathname.replace("/api/v2", "") + new URL(t.data.url).search;
  const first = await call("GET", path, { headers: { "cf-connecting-ip": "1.1.1.1" } });
  assert.equal(first.status, 200);
  assert.match(first.res.headers.get("content-disposition") ?? "", /attachment; filename\*=UTF-8''/);
  assert.equal((await call("GET", path, { headers: { "cf-connecting-ip": "2.2.2.2" } })).status, 410, "不同網路用同一個連結失效");
  assert.equal((await call("GET", path, { headers: { "cf-connecting-ip": "1.1.1.1" } })).status, 410, "沒帶續傳範圍失效");
  const resumed = await call("GET", path, { headers: { "cf-connecting-ip": "1.1.1.1", range: "bytes=2-" } });
  assert.equal(resumed.status, 206, "同一個網路可以續傳");
  assert.equal(resumed.res.headers.get("content-range"), "bytes 2-4/5");
  assert.equal(resumed.text.length, 3);
  assert.equal((await call("GET", "/media/dl?t=" + "x".repeat(32))).status, 410);

  assert.equal((await call("POST", "/materials/att2/ticket", { token: student })).status, 403, "沒報名付費課的學員拿不到");
  assert.equal((await call("POST", "/materials/att2/ticket", { token: admin })).status, 200, "管理員可以");
  assert.ok((await db.prepare("SELECT COUNT(*) AS n FROM material_downloads").first<{ n: number }>())!.n >= 1);

  // 每日下載次數上限、設定權限
  assert.equal((await call("PUT", "/admin/files/settings", { token: student, body: { dailyDownloads: 1 } })).status, 403);
  assert.equal((await call("PUT", "/admin/files/settings", { token: admin, body: { dailyDownloads: 1 } })).status, 200);
  assert.equal((await call("POST", "/materials/att1/ticket", { token: student })).status, 429);
  const st = await call("GET", "/admin/storage", { token: admin });
  assert.equal(st.data.fileSettings.dailyDownloads, 1);
});

test("從使用者自己的 Google 雲端硬碟匯入：轉存 R2、分段、Google 文件轉檔、擋影片與過大檔案、不保存權杖", async () => {
  const { db, r2, call, login } = harness({ GOOGLE_CLIENT_ID: "cid", GOOGLE_PICKER_API_KEY: "key", GOOGLE_PROJECT_NUMBER: "123" });
  const admin = await login("demo-admin");
  const student = await login("demo-student");
  const course = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { isList: true, title: "清單" } })).data;
  const imp = (fileId: string, token = TOKEN, who = admin) => call("POST", `/admin/courses/${course.id}/drive-import`, { token: who, body: { fileId, token } });
  const big = bytes(PART_BYTES * 2 + 123, 9);
  fakeUserDrive({
    small0001: { name: "簡報.pdf", mimeType: "application/pdf", body: bytes(10) },
    bigfile01: { name: "大檔.pdf", mimeType: "application/pdf", body: big },
    gdoc00001: { name: "我的文件", mimeType: "application/vnd.google-apps.document", body: bytes(20) },
    video0001: { name: "影片.mp4", mimeType: "video/mp4", body: bytes(5) },
    folder001: { name: "資料夾", mimeType: "application/vnd.google-apps.folder", body: bytes(0) },
    trash0001: { name: "舊檔.pdf", mimeType: "application/pdf", body: bytes(5), trashed: true },
    huge00001: { name: "超大.pdf", mimeType: "application/pdf", size: 5 * 1024 * 1024, body: bytes(5) },
    empty0001: { name: "空.pdf", mimeType: "application/pdf", body: bytes(0), size: 0 },
  });

  // 設定檔：缺金鑰時不顯示來源
  const cfg = await call("GET", "/admin/drive-import/config", { token: admin });
  assert.deepEqual([cfg.data.ready, cfg.data.clientId, cfg.data.apiKey, cfg.data.appId], [true, "cid", "key", "123"]);
  assert.equal(cfg.data.maxBytes, 200 * 1024 * 1024);
  assert.equal((await call("GET", "/admin/drive-import/config", { token: student })).status, 403);

  // 小檔：直接存
  const ok = await imp("small0001");
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const att = await db.prepare("SELECT r2_key, size, att_type, name FROM lesson_attachments WHERE lesson_id = ?").bind(ok.data.id).first<{ r2_key: string; size: number; att_type: string; name: string }>();
  assert.equal(att!.size, 10);
  assert.equal(att!.att_type, "pdf");
  assert.match(att!.r2_key, /^file\/[\w-]+\/[\w-]+\/簡報\.pdf$/);
  assert.equal(r2.store.get(att!.r2_key)!.data.byteLength, 10);
  assert.equal(r2.partCalls, 0, "小檔不分段");

  // 大檔：分段，內容完整
  const bigOk = await imp("bigfile01");
  assert.equal(bigOk.status, 200);
  const bigAtt = await db.prepare("SELECT r2_key FROM lesson_attachments WHERE lesson_id = ?").bind(bigOk.data.id).first<{ r2_key: string }>();
  const stored = r2.store.get(bigAtt!.r2_key)!.data;
  assert.equal(stored.byteLength, big.byteLength);
  assert.ok(stored.every((v) => v === 9));
  assert.equal(r2.partCalls, 3);

  // Google 文件：自動轉成 PDF
  const doc = await imp("gdoc00001");
  assert.equal(doc.status, 200);
  assert.equal((await db.prepare("SELECT name, att_type FROM lesson_attachments WHERE lesson_id = ?").bind(doc.data.id).first<{ name: string; att_type: string }>())!.name, "我的文件.pdf");

  // 被擋的情況
  assert.equal((await imp("video0001")).data.error.code, "video_not_allowed");
  assert.equal((await imp("folder001")).data.error.code, "google_folder");
  assert.equal((await imp("trash0001")).status, 404);
  assert.equal((await imp("nothere01")).status, 404);
  assert.equal((await imp("huge00001")).status, 200, "預設 200MB 內可以");
  await call("PUT", "/admin/files/settings", { token: admin, body: { importMaxMb: 1 } });
  assert.equal((await imp("huge00001")).status, 413);
  assert.equal((await imp("bigfile01")).status, 413, "實際內容超過上限時串流中止");
  assert.equal((await imp("empty0001")).status, 400);
  assert.equal((await imp("small0001", "bad token with spaces")).status, 400);
  assert.equal((await imp("small0001", "user-token-expiredexpiredexpired")).status, 401);
  assert.equal((await imp("small0001", TOKEN, student)).status, 403, "學員不能匯入");
  const keysBefore = r2.store.size;
  assert.equal((await imp("bigfile01")).status, 413);
  assert.equal(r2.store.size, keysBefore, "失敗時不留殘檔");

  // 權杖不保存
  for (const t of ["ui_settings", "audit_log", "lesson_attachments", "lessons"]) {
    const rows = await db.prepare(`SELECT * FROM ${t}`).all();
    assert.ok(!JSON.stringify(rows.results).includes(TOKEN), `${t} 不可有權杖`);
  }
});

test("舊的雲端硬碟授權：排程撤銷並刪除", async () => {
  const { db } = harness();
  const seen = fakeUserDrive({});
  assert.equal(await revokeLegacyDriveLink(db), false);
  await db.prepare("INSERT INTO drive_link (id, refresh_token, account_email, folder_id, connected_by) VALUES (1, 'old-refresh-token', 'a@b.c', 'f', 'x')").run();
  await db.prepare("INSERT INTO ui_settings (key, value) VALUES ('drive', '{}')").run();
  assert.equal(await revokeLegacyDriveLink(db), true);
  assert.ok(seen.some((u) => u.startsWith("POST https://oauth2.googleapis.com/revoke?token=old-refresh-token")));
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM drive_link").first<{ n: number }>())!.n, 0);
  assert.equal(await db.prepare("SELECT 1 AS x FROM ui_settings WHERE key = 'drive'").first(), null);
});
