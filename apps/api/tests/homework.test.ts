import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteMemberData, handleApi, handleFile, scheduled } from "../src/api.ts";
import type { ActivityCard, ActivityView, ItemView, PeopleView, QueueEntry } from "../src/contract.ts";
import type { Env } from "../src/env.ts";
import { createTestDb, memR2 } from "./sqlite-d1.ts";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 40 }, (_, i) => i)]);
const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, ...Array.from({ length: 40 }, () => 1)]);
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);

function setup() {
  const bucket = memR2();
  const env: Env = { DB: createTestDb(), FILES: bucket, DEV_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(who: string, method: string, path: string, opts: { body?: unknown; bytes?: Uint8Array } = {}) => {
    const headers: Record<string, string> = { authorization: `Bearer dev:${who}` };
    if (!opts.bytes && opts.body !== undefined) headers["content-type"] = "application/json";
    const res = await handleApi(new Request(`https://check.test/api${path}`, { method, headers, body: (opts.bytes as unknown as BodyInit) ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) }), env);
    const text = await res.text();
    return { status: res.status, data: (text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text) as T };
  };
  return { env, bucket, call };
}

test("美力之星：出作業、加入、分組、繳交、組長確認、老師三種評分、互看、權限", async () => {
  const { env, bucket, call } = setup();
  // 超級管理員（dev:admin…）新增作業
  assert.equal((await call("amy", "POST", "/activities", { body: { title: "x" } })).status, 403, "一般會員不能新增");
  const { id } = (await call<{ id: string }>("admin1", "POST", "/activities", { body: { title: "美力之星 第二屆", startsOn: "2026-12-05" } })).data;
  const due = new Date(Date.now() + 2 * 86400_000).toISOString();
  const l3 = (await call<{ id: string }>("admin1", "POST", `/activities/${id}/lessons`, { body: { title: "第三堂", dueAt: due } })).data.id;
  const photos = (await call<{ id: string }>("admin1", "POST", `/lessons/${l3}/items`, { body: { name: "卸妝乳示範照", mode: "count", per: 1, unit: "張", maxPoints: 5, kinds: ["photo"] } })).data.id;
  const video = (await call<{ id: string }>("admin1", "POST", `/lessons/${l3}/items`, { body: { name: "示範影片", mode: "fixed", points: 10, kinds: ["video", "link"] } })).data.id;
  const ppt = (await call<{ id: string }>("admin1", "POST", `/lessons/${l3}/items`, { body: { name: "分享簡報", mode: "score", fullScore: 30, kinds: ["file", "text"] } })).data.id;
  const clip = (await call<{ id: string }>("admin1", "POST", `/lessons/${l3}/items`, { body: { name: "花絮影片", mode: "stars", per: 1, kinds: ["video", "link"] } })).data.id;
  const exam = (await call<{ id: string }>("admin1", "POST", `/lessons/${l3}/items`, { body: { name: "穴位圖筆試", mode: "onsite" } })).data.id;

  // 草稿狀態學員看不到；開放後透過連結加入（需要核准）
  const act = (await call<ActivityView>("admin1", "GET", `/activities/${id}`)).data;
  const code = act.activity.joinCode;
  for (const s of ["amy", "bob", "cat", "dan"]) assert.equal((await call<{ status: string }>(s, "POST", `/join/${code}`)).data.status, "pending");
  assert.equal((await call("amy", "GET", `/activities/${id}`)).status, 403, "草稿看不到");
  await call("admin1", "PATCH", `/activities/${id}`, { body: { status: "open" } });
  assert.equal((await call("amy", "GET", `/items/${photos}`)).status, 403, "還沒核准不能交");
  for (const s of ["amy", "bob", "cat", "dan"]) assert.equal((await call("admin1", "POST", `/activities/${id}/people/${s}`, { body: { action: "approve" } })).status, 200);

  // 分組：老師建組、組連結加入、指定組長；組長只能拉未分組的人
  const g1 = (await call<{ id: string }>("admin1", "POST", `/activities/${id}/groups`, { body: { name: "第 1 組" } })).data.id;
  const g2 = (await call<{ id: string }>("admin1", "POST", `/activities/${id}/groups`, {})).data.id;
  const ppl = (await call<PeopleView>("admin1", "GET", `/activities/${id}/people`)).data;
  const g1code = ppl.groups.find((g) => g.id === g1)!.joinCode!;
  assert.equal((await call("amy", "POST", `/join/${g1code}`)).status, 200, "組連結：已加入的人會分到這一組");
  await call("admin1", "POST", `/activities/${id}/people/bob`, { body: { action: "group", groupId: g1 } });
  await call("admin1", "POST", `/activities/${id}/people/dan`, { body: { action: "group", groupId: g2 } });
  assert.equal((await call("amy", "POST", `/activities/${id}/people/amy`, { body: { action: "leader" } })).status, 403, "學員不能指定組長");
  await call("admin1", "POST", `/activities/${id}/people/amy`, { body: { action: "leader" } });
  assert.equal((await call("amy", "POST", `/activities/${id}/people/dan`, { body: { action: "group", groupId: g1 } })).status, 403, "組長不能搶別組的人");
  assert.equal((await call("amy", "POST", `/activities/${id}/people/cat`, { body: { action: "group", groupId: g1 } })).status, 200, "組長可以拉未分組的人");
  const amyPeople = (await call<PeopleView>("amy", "GET", `/activities/${id}/people`)).data;
  assert.equal(amyPeople.groups.length, 1, "組長只看到自己這組");
  assert.equal(amyPeople.groups[0].members.length, 3);

  // 學員繳交：照片（張數）、影片、檔案、連結、文字
  assert.equal((await call("bob", "POST", `/items/${photos}/submit`, { body: { declared: 3 } })).status, 400, "沒放東西不能送出");
  assert.equal((await call("bob", "POST", `/items/${photos}/files?kind=photo&name=a.jpg`, { bytes: new Uint8Array([1, 2, 3]) })).status, 400, "不是照片");
  assert.equal((await call("bob", "POST", `/items/${photos}/files?kind=video&name=a.mp4`, { bytes: mp4 })).status, 400, "這一項不收影片");
  for (let i = 0; i < 3; i++) assert.equal((await call("bob", "POST", `/items/${photos}/files?kind=photo&name=p${i}.jpg`, { bytes: jpeg })).status, 200);
  assert.equal((await call("bob", "POST", `/items/${photos}/submit`, {})).status, 400, "每件計分要填張數");
  let v = (await call<ItemView>("bob", "POST", `/items/${photos}/submit`, { body: { declared: 6, note: "多拍了" } })).data;
  assert.equal(v.my!.status, "submitted");
  assert.equal(v.canEdit, false);
  assert.equal((await call("bob", "POST", `/items/${photos}/files?kind=photo&name=x.jpg`, { bytes: jpeg })).status, 400, "送出後不能直接改");
  v = (await call<ItemView>("bob", "POST", `/items/${photos}/unsubmit`)).data;
  assert.equal(v.my!.status, "draft", "截止前可以收回修改");
  await call("bob", "POST", `/items/${photos}/submit`, { body: { declared: 6 } });
  assert.equal((await call("bob", "POST", `/items/${video}/files?kind=video&name=v.mp4&dur=200`, { bytes: mp4 })).status, 413, "影片超過 3 分鐘");
  assert.equal((await call("bob", "POST", `/items/${video}/files?kind=video&name=v.mp4&dur=95`, { bytes: mp4 })).status, 200);
  await call("bob", "POST", `/items/${video}/submit`, {});
  assert.equal((await call("bob", "POST", `/items/${ppt}/files?kind=file&name=a.mov`, { bytes: mp4 })).status, 400, "影片要用短影片上傳");
  assert.equal((await call("bob", "POST", `/items/${ppt}/files?kind=file&name=簡報.pdf`, { bytes: pdf })).status, 200);
  assert.equal((await call("bob", "POST", `/items/${ppt}/entries`, { body: { kind: "text", body: "我的心得" } })).status, 200);
  await call("bob", "POST", `/items/${ppt}/submit`, {});
  assert.equal((await call("bob", "POST", `/items/${clip}/entries`, { body: { kind: "link", url: "youtu.be/abc" } })).status, 200);
  await call("bob", "POST", `/items/${clip}/submit`, {});
  assert.equal((await call("bob", "POST", `/items/${exam}/files?kind=photo&name=a.jpg`, { bytes: jpeg })).status, 400, "老師登錄的項目不用上傳");

  // 同組互看：看得到作品、看不到分數；別組看不到
  const amyView = (await call<ItemView>("cat", "GET", `/items/${photos}`)).data;
  assert.equal(amyView.peers.length, 1, "同組看得到已送出的作業");
  const subId = amyView.peers[0].submissionId;
  assert.equal((await call("dan", "GET", `/submissions/${subId}`)).status, 403, "別組看不到");

  // 組長確認或退回（不能評分）
  assert.equal((await call("amy", "POST", `/submissions/${subId}/grade`, { body: { approved: 5 } })).status, 403, "組長不能評分");
  const leaderQ = (await call<QueueEntry[]>("amy", "GET", `/activities/${id}/queue`)).data;
  assert.equal(leaderQ.length, 4, "組長看到組員剛送出的");
  assert.equal((await call("amy", "POST", `/submissions/${subId}/return`, { body: {} })).status, 400, "退回要寫原因");
  assert.equal((await call("amy", "POST", `/submissions/${subId}/leader-ok`, { body: { note: "沒問題" } })).status, 200);

  // 老師批改台：每件計分（上限 5 分）、完成給分、分數、星等
  const q = (await call<QueueEntry[]>("admin1", "GET", `/activities/${id}/queue`)).data;
  assert.equal(q.length, 4);
  const byItem = (it: string) => q.find((e) => e.item.id === it)!.submission.id;
  assert.equal((await call("admin1", "POST", `/submissions/${byItem(photos)}/grade`, { body: { approved: 6, comment: "很好" } })).status, 200);
  assert.equal((await call("admin1", "POST", `/submissions/${byItem(video)}/grade`, { body: {} })).status, 200);
  assert.equal((await call("admin1", "POST", `/submissions/${byItem(ppt)}/grade`, { body: { score: 40 } })).status, 400, "超過滿分");
  assert.equal((await call("admin1", "POST", `/submissions/${byItem(ppt)}/grade`, { body: { score: 27 } })).status, 200);
  assert.equal((await call("admin1", "POST", `/submissions/${byItem(clip)}/return`, { body: { comment: "畫面太暗" } })).status, 200);
  assert.equal((await call("admin1", "POST", `/items/${exam}/onsite`, { body: { memberId: "bob", score: 92 } })).status, 200);

  const bobAct = (await call<ActivityView>("bob", "GET", `/activities/${id}`)).data;
  assert.equal(bobAct.total, 5 + 10 + 27, "總分＝上限 5 分＋10＋27（筆試另計）");
  const bobPhoto = (await call<ItemView>("bob", "GET", `/items/${photos}`)).data;
  assert.equal(bobPhoto.my!.points, 5);
  assert.equal(bobPhoto.my!.comment, "很好");
  assert.equal(bobPhoto.canEdit, false, "評分後不能改");
  const peerSub = (await call<{ submission: { points: number | null } }>("cat", "GET", `/submissions/${subId}`)).data.submission;
  assert.equal(peerSub.points, null, "同組看不到分數");
  const clipView = (await call<ItemView>("bob", "GET", `/items/${clip}`)).data;
  assert.equal(clipView.my!.status, "returned");
  assert.equal(clipView.canEdit, true, "退回可以改");
  await call("bob", "POST", `/items/${clip}/submit`, {});
  const q2 = (await call<QueueEntry[]>("admin1", "GET", `/activities/${id}/queue`)).data;
  assert.equal((await call("admin1", "POST", `/submissions/${q2[0].submission.id}/grade`, { body: { stars: 4 } })).status, 200);
  assert.equal((await call<ActivityView>("bob", "GET", `/activities/${id}`)).data.total, 46);

  // 通知
  const notes = (await call<{ title: string }[]>("bob", "GET", "/notices")).data;
  assert.ok(notes.some((n) => n.title === "作業被退回重交"));
  assert.ok(notes.some((n) => n.title === "老師已評分"));

  // 檔案只能用短效憑證讀取，別組拿不到憑證
  const fileId = bobPhoto.my!.files[0].id;
  assert.equal((await call("dan", "POST", `/files/${fileId}/ticket`)).status, 403);
  const t = (await call<{ url: string }>("cat", "POST", `/files/${fileId}/ticket`)).data.url;
  const got = await handleFile(new Request(`https://check.test${t}`), env);
  assert.equal(got.status, 200);
  const part = await handleFile(new Request(`https://check.test${t}`, { headers: { range: "bytes=0-3" } }), env);
  assert.equal(part.status, 206);
  assert.equal((await handleFile(new Request(`https://check.test/f/nope`), env)).status, 410);

  // 首頁卡片
  const cards = (await call<ActivityCard[]>("bob", "GET", "/home")).data;
  assert.equal(cards[0].total, 46);
  assert.equal((await call<ActivityCard[]>("admin1", "GET", "/home")).data[0].role, "manager");

  // 成績表
  const csv = await call<string>("admin1", "GET", `/activities/${id}/scores`);
  assert.match(csv.data, /總分/);
  assert.equal((await call("bob", "GET", `/activities/${id}/scores`)).status, 403);

  // 刪除全部檔案：R2 清空、成績保留
  assert.ok(bucket.keys().length > 0);
  assert.equal((await call("bob", "POST", `/activities/${id}/purge`)).status, 403);
  await call("admin1", "POST", `/activities/${id}/purge`);
  assert.equal(bucket.keys().length, 0);
  assert.equal((await call<ActivityView>("bob", "GET", `/activities/${id}`)).data.total, 46, "成績保留");
});

test("會員刪除帳號：作業檔案與資料一併刪除；排程截止提醒與到期刪檔", async () => {
  const { env, bucket, call } = setup();
  const { id } = (await call<{ id: string }>("admin1", "POST", "/activities", { body: { title: "測試" } })).data;
  await call("admin1", "PATCH", `/activities/${id}`, { body: { status: "open", joinApproval: false, retentionUntil: "2020-01-01" } });
  const l = (await call<{ id: string }>("admin1", "POST", `/activities/${id}/lessons`, { body: { dueAt: new Date(Date.now() + 20 * 3600_000).toISOString() } })).data.id;
  const it = (await call<{ id: string }>("admin1", "POST", `/lessons/${l}/items`, { body: { name: "照片", kinds: ["photo"] } })).data.id;
  const code = (await call<ActivityView>("admin1", "GET", `/activities/${id}`)).data.activity.joinCode;
  for (const s of ["amy", "bob"]) assert.equal((await call<{ status: string }>(s, "POST", `/join/${code}`)).data.status, "active");
  await call("amy", "POST", `/items/${it}/files?kind=photo&name=a.jpg`, { bytes: jpeg });
  assert.equal(bucket.keys().length, 1);
  await deleteMemberData(env, "amy");
  assert.equal(bucket.keys().length, 0, "R2 不留殘檔");
  assert.equal((await call("amy", "GET", `/items/${it}`)).status, 403, "成員資格也刪了");

  await call("bob", "POST", `/items/${it}/files?kind=photo&name=a.jpg`, { bytes: jpeg });
  await scheduled(env);
  const notes = (await call<{ title: string }[]>("bob", "GET", "/notices")).data;
  assert.ok(notes.some((n) => n.title === "作業明天截止"), "沒送出的人收到提醒");
  assert.equal(bucket.keys().length, 0, "保存期限到了自動刪檔");
  await scheduled(env);
  assert.equal((await call<{ title: string }[]>("bob", "GET", "/notices")).data.filter((n) => n.title === "作業明天截止").length, 1, "不重複提醒");
});
