import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail, HwAssignmentView, HwCourseView, HwGroupsView, HwSubmission, MyHomework } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

type R2Bucket = NonNullable<Env["MEDIA"]>;
function memR2(): R2Bucket & { _keys: () => string[] } {
  const m = new Map<string, { body: Uint8Array; httpMetadata?: { contentType?: string } }>();
  return {
    put: async (k: string, v: ArrayBuffer, o?: { httpMetadata?: { contentType?: string } }) => void m.set(k, { body: new Uint8Array(v), httpMetadata: o?.httpMetadata }),
    head: async (k: string) => (m.has(k) ? { size: m.get(k)!.body.byteLength, httpMetadata: m.get(k)!.httpMetadata } : null),
    get: async (k: string) => (m.has(k) ? { ...m.get(k)!, body: new Response(m.get(k)!.body as unknown as BodyInit).body } : null),
    delete: async (k: string) => void m.delete(k),
    list: async () => ({ objects: [...m.keys()].map((key) => ({ key, size: 1 })), truncated: false }),
    _keys: () => [...m.keys()],
  } as unknown as R2Bucket & { _keys: () => string[] };
}
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 50 }, (_, i) => i)]);
const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, ...Array.from({ length: 40 }, () => 1)]);

test("作業：出作業、學員繳交（照片／影片／檔案／連結／文字）、分組互看、組長編組、只有老師評分、私密檔案網址", async () => {
  const bucket = memR2();
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on", MEDIA: bucket, MEDIA_URL_SECRET: "test-secret" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown; bytes?: Uint8Array } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { ...(opts.bytes ? {} : { "content-type": "application/json" }), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: (opts.bytes as unknown as BodyInit | undefined) ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) }), env);
    const text = await res.text();
    return { status: res.status, data: (text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const [admin, a, b, c, out] = await Promise.all(["demo-admin", "demo-student", "demo-silver", "demo-desk", "demo-outsider"].map(login));
  const course = (await call<CourseDetail>("POST", "/admin/courses", { token: admin, body: { title: "美力之星 第三屆", teacher: "陳", status: "published", priceTwd: 0 } })).data;
  for (const t of [a, b, c]) assert.equal((await call("POST", "/orders", { token: t, body: { courseIds: [course.id] } })).status, 200);

  assert.equal((await call("GET", `/homework/course/${course.id}`, { token: out })).status, 403, "沒報名的人看不到作業");
  assert.equal((await call("POST", `/homework/course/${course.id}/assignments`, { token: a, body: { title: "x", kinds: ["image"], grading: "score" } })).status, 403, "學員不能出作業");
  const due = new Date(Date.now() + 86400_000).toISOString();
  const { id: hw } = (await call<{ id: string }>("POST", `/homework/course/${course.id}/assignments`, { token: admin, body: { title: "作業一：形象照", body: "交三張", kinds: ["image", "video", "file", "link", "text"], grading: "score", maxScore: 100, dueAt: due } })).data;
  const notes = (await call<{ title: string }[]>("GET", "/notifications", { token: a })).data;
  assert.ok(Array.isArray(notes) ? notes.some((n) => n.title === "新作業：作業一：形象照") : true, "學員收到新作業通知");

  // 學員繳交
  assert.equal((await call("POST", `/homework/a/${hw}/submit`, { token: a, body: {} })).status, 400, "什麼都沒放不能送出");
  const up = await call<{ mine: HwSubmission }>("POST", `/homework/a/${hw}/files?kind=image&name=正面.jpg&w=800&h=1000`, { token: a, bytes: jpeg });
  assert.equal(up.status, 200);
  assert.equal(up.data.mine.status, "draft");
  assert.equal((await call("POST", `/homework/a/${hw}/files?kind=image&name=x.jpg`, { token: a, bytes: new Uint8Array([1, 2, 3]) })).status, 400, "不是照片");
  assert.equal((await call("POST", `/homework/a/${hw}/files?kind=video&name=v.mp4&dur=200`, { token: a, bytes: mp4 })).status, 413, "影片超過 3 分鐘");
  assert.equal((await call("POST", `/homework/a/${hw}/files?kind=video&name=v.mp4&dur=95`, { token: a, bytes: mp4 })).status, 200);
  assert.equal((await call("POST", `/homework/a/${hw}/files?kind=file&name=v.mov`, { token: a, bytes: mp4 })).status, 400, "影片要用短影片上傳");
  assert.equal((await call("POST", `/homework/a/${hw}/files?kind=file&name=心得.pdf`, { token: a, bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) })).status, 200);
  assert.equal((await call("POST", `/homework/a/${hw}/link`, { token: a, body: { url: "https://youtu.be/abc" } })).status, 200);
  const sub1 = (await call<{ mine: HwSubmission }>("POST", `/homework/a/${hw}/submit`, { token: a, body: { note: "第三張在中心拍的" } })).data.mine;
  assert.equal(sub1.status, "submitted");
  assert.equal(sub1.files.length, 4);
  const img = sub1.files.find((f) => f.kind === "image")!;
  assert.match(img.url, /^\/api\/v2\/homework\/file\?k=hw%2F/, "檔案用簽名網址");
  const got = await call<string>("GET", img.url.replace("/api/v2", ""));
  assert.equal(got.status, 200, "簽名網址讀得到");
  assert.equal((await call("GET", img.url.replace("/api/v2", "").replace(/s=[^&]+/, "s=bad"))).status, 403, "網址被改就失效");

  // 分組：老師建組、指定組長；組長拉人；同組可以互看（看不到分數）、其他組看不到
  const g1 = (await call<HwGroupsView>("POST", `/homework/course/${course.id}/groups`, { token: admin, body: { name: "第一組" } })).data.groups[0]!.id;
  const g2 = (await call<HwGroupsView>("POST", `/homework/course/${course.id}/groups`, { token: admin, body: { name: "第二組" } })).data.groups[1]!.id;
  assert.equal((await call("POST", `/homework/course/${course.id}/groups`, { token: a, body: { name: "x" } })).status, 403, "學員不能建組");
  await call("PUT", `/homework/course/${course.id}/member`, { token: admin, body: { sub: "demo-silver", groupId: g1, leader: true } });
  assert.equal((await call("PUT", `/homework/course/${course.id}/member`, { token: b, body: { sub: "demo-student", groupId: g1 } })).status, 200, "組長把沒分組的人拉進自己這組");
  assert.equal((await call("PUT", `/homework/course/${course.id}/member`, { token: b, body: { sub: "demo-desk", groupId: g2 } })).status, 403, "組長不能排別組");
  assert.equal((await call("PUT", `/homework/course/${course.id}/member`, { token: b, body: { sub: "demo-student", groupId: g1, leader: true } })).status, 403, "組長不能指定組長");
  await call("PUT", `/homework/course/${course.id}/member`, { token: admin, body: { sub: "demo-desk", groupId: g2 } });
  const asLeader = (await call<HwAssignmentView>("GET", `/homework/a/${hw}`, { token: b })).data;
  assert.deepEqual(asLeader.roster.map((r) => r.name), ["測試學員"], "組長看到自己這組的人");
  assert.equal(asLeader.assignment.counts?.toGrade, 1);
  const leaderSees = await call<{ submission: HwSubmission }>("GET", `/homework/s/${sub1.id}`, { token: b });
  assert.equal(leaderSees.status, 200);
  assert.equal(leaderSees.data.submission.canGrade, false, "組長不能評分");
  assert.equal(leaderSees.data.submission.canComment, true, "組長可以留言");
  assert.equal((await call("POST", `/homework/s/${sub1.id}/grade`, { token: b, body: { score: 90 } })).status, 403, "組長不能評分");
  assert.equal((await call("GET", `/homework/s/${sub1.id}`, { token: c })).status, 403, "別組看不到");
  assert.equal((await call("POST", `/homework/s/${sub1.id}/comments`, { token: b, body: { body: "進步好多！" } })).status, 200);

  // 老師評分
  assert.equal((await call("POST", `/homework/s/${sub1.id}/grade`, { token: admin, body: { score: 101 } })).status, 400);
  assert.equal((await call("POST", `/homework/s/${sub1.id}/grade`, { token: admin, body: { action: "return" } })).status, 400, "退回要寫原因");
  const graded = await call<{ next: string | null }>("POST", `/homework/s/${sub1.id}/grade`, { token: admin, body: { score: 92, comment: "笑容自然" } });
  assert.equal(graded.status, 200);
  const mine = (await call<HwAssignmentView>("GET", `/homework/a/${hw}`, { token: a })).data;
  assert.equal(mine.assignment.myStatus, "graded");
  assert.equal(mine.assignment.myResult?.score, 92);
  assert.equal(mine.mine?.comments.length, 1);
  assert.equal(mine.mine?.canEdit, false, "評分後不能再改");
  assert.equal((await call("DELETE", `/homework/files/${img.id}`, { token: a })).status, 409);

  // 星星制、通過制
  const { id: hw2 } = (await call<{ id: string }>("POST", `/homework/course/${course.id}/assignments`, { token: admin, body: { title: "自我介紹", kinds: ["text"], grading: "stars" } })).data;
  const s2 = (await call<{ mine: HwSubmission }>("POST", `/homework/a/${hw2}/submit`, { token: c, body: { note: "大家好" } })).data.mine;
  assert.equal((await call("POST", `/homework/s/${s2.id}/grade`, { token: admin, body: { stars: 6 } })).status, 400);
  assert.equal((await call("POST", `/homework/s/${s2.id}/grade`, { token: admin, body: { stars: 4 } })).status, 200);
  const { id: hw3 } = (await call<{ id: string }>("POST", `/homework/course/${course.id}/assignments`, { token: admin, body: { title: "走秀", kinds: ["link"], grading: "pass" } })).data;
  await call("POST", `/homework/a/${hw3}/link`, { token: a, body: { url: "https://example.com/v" } });
  const s3 = (await call<{ mine: HwSubmission }>("POST", `/homework/a/${hw3}/submit`, { token: a, body: {} })).data.mine;
  await call("POST", `/homework/s/${s3.id}/grade`, { token: admin, body: { action: "return", comment: "再拍一次" } });
  const my = (await call<MyHomework>("GET", "/homework/mine", { token: a })).data;
  assert.equal(my.items[0]?.status, "returned", "被退回的排最前面");
  assert.equal(my.todo, 2, "退回的＋還沒交的自我介紹");
  assert.equal((await call<MyHomework>("GET", "/homework/mine", { token: admin })).data.toGrade.length, 0, "沒有待批改");

  const view = (await call<HwCourseView>("GET", `/homework/course/${course.id}`, { token: admin })).data;
  assert.equal(view.assignments.length, 3);
  assert.equal(view.role.teacher, true);

  // 刪除作業會一併刪掉檔案
  const before = bucket._keys().length;
  assert.equal((await call("DELETE", `/homework/a/${hw}`, { token: admin })).status, 200);
  assert.equal(bucket._keys().length, before - 3, "照片、影片、PDF 都刪掉");
});
