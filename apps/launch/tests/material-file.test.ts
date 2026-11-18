import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env, R2Bucket } from "../src/d1.ts";
import { classifyFile } from "../src/files.ts";
const FILE_MAX_BYTES = 30 * 1024 * 1024;
import { createTestDb } from "./sqlite-d1.ts";

const memR2 = (): R2Bucket & { store: Map<string, { data: Uint8Array; type?: string }> } => {
  const store = new Map<string, { data: Uint8Array; type?: string }>();
  return {
    store,
    async head(k: string) { const o = store.get(k); return o ? { size: o.data.byteLength } : null; },
    async get(k: string) { const o = store.get(k); return o ? { size: o.data.byteLength, httpMetadata: { contentType: o.type }, body: new Response(o.data as Uint8Array<ArrayBuffer>).body! } : null; },
    async delete(k: string) { store.delete(k); },
    async list() { return { objects: [...store].map(([key, o]) => ({ key, size: o.data.byteLength })), truncated: false }; },
    async put(k: string, v: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) { store.set(k, { data: new Uint8Array(v), type: opts?.httpMetadata?.contentType }); },
    async createMultipartUpload() { throw new Error("x"); },
    resumeMultipartUpload() { throw new Error("x"); },
  } as never;
};

test("檔案類型判斷：影片不行、圖片與文件可以", () => {
  assert.equal(classifyFile("a.MP4"), "video");
  assert.equal(classifyFile("影片.mov"), "video");
  assert.deepEqual(classifyFile("簡報.pptx"), { type: "ppt", ct: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  assert.equal((classifyFile("x.jpg") as { type: string }).type, "image");
  assert.equal(classifyFile("x.exe"), null);
});

test("教材上傳檔案：建立教材、下載、超過 30MB 與影片被擋；儲存空間統計", async () => {
  const db = createTestDb();
  const r2 = memR2();
  const env: Env = { DB: db, DEMO_LOGIN: "on", MEDIA: r2 };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: BodyInit; json?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { ...(opts.json !== undefined ? { "content-type": "application/json" } : {}), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body }), env);
    return { status: res.status, res, data: (res.headers.get("content-type")?.includes("json") ? await res.clone().json() : null) as T };
  };
  const admin = (await call<{ token: string }>("POST", "/auth/demo", { json: { sub: "demo-admin" } })).data.token;
  const student = (await call<{ token: string }>("POST", "/auth/demo", { json: { sub: "demo-student" } })).data.token;
  const c = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, json: { isList: true, title: "清單" } })).data;
  const up = (name: string, data: Uint8Array, token = admin) => call<CourseDetail & { error?: { code: string; message: string } }>("POST", `/admin/courses/${c.id}/material-file?name=${encodeURIComponent(name)}`, { token, body: data as unknown as BodyInit });
  assert.equal((await up("簡報.pptx", new Uint8Array([1, 2, 3]), student)).status, 403);
  assert.equal((await up("a.mp4", new Uint8Array([1]))).status, 400);
  assert.equal((await up("a.exe", new Uint8Array([1]))).status, 400);
  const big = await up("大.pdf", new Uint8Array(FILE_MAX_BYTES + 1));
  assert.equal(big.status, 413);
  const ok = await up("簡報.pptx", new Uint8Array([1, 2, 3, 4]));
  assert.equal(ok.status, 200);
  const lesson = ok.data.lessons.find((l) => l.title === "簡報")!;
  assert.equal(lesson.linkType, "ppt");
  assert.match(lesson.linkUrl ?? "", /\/api\/v2\/media\/file\?k=file%2F/);
  const dl = await handleApi(new Request(lesson.linkUrl!), env);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get("content-disposition") ?? "", /attachment/);
  assert.equal((await dl.arrayBuffer()).byteLength, 4);
  assert.equal((await handleApi(new Request("https://learn.test/api/v2/media/file?k=file%2Fx%2Fy%2Fz"), env)).status, 404);
  const st = await call<{ totalBytes: number; byType: { doc: number }; byCenter: { center: string; doc: number }[] }>("GET", "/admin/storage", { token: admin });
  assert.equal(st.status, 200);
  assert.equal(st.data.totalBytes, 4);
  assert.deepEqual([st.data.byType.doc, st.data.byCenter[0]!.center, st.data.byCenter[0]!.doc], [4, "寰宇總部", 4]);
  assert.equal((await call("GET", "/admin/storage", { token: student })).status, 403);
});
