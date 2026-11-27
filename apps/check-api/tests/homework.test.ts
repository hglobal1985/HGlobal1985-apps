import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteMemberData, handleApi, handleFile, handleZip, retentionOf, scheduled } from "../src/api.ts";
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

test("上傳壓縮設定：與行動大學共用同一份，只有超級管理員能改", async () => {
  const { resetSharedUploadMemo } = await import("../../../packages/server-shared/src/upload-settings.ts");
  resetSharedUploadMemo();
  const store = new Map<string, string>();
  const { env, call } = setup();
  env.SHARED = { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v) };
  const r = await call<{ settings: { imageMaxSide: number }; canEdit: boolean }>("amy", "GET", "/upload-settings");
  assert.equal(r.data.settings.imageMaxSide, 1024);
  assert.equal(r.data.canEdit, false);
  assert.equal((await call("amy", "PUT", "/upload-settings", { body: { imageMaxSide: 1600 } })).status, 403);
  const w = await call<{ settings: { imageMaxSide: number; imageQuality: number } }>("admin1", "PUT", "/upload-settings", { body: { imageMaxSide: 1600, imageQuality: 5 } });
  assert.equal(w.data.settings.imageMaxSide, 1600);
  assert.equal(w.data.settings.imageQuality, 30, "超出範圍自動修正");
  assert.equal(JSON.parse(store.get("upload")!).imageMaxSide, 1600, "寫進共用儲存區（行動大學讀同一個鍵）");
});

test("手機推播：訂閱、站內通知新增後推到裝置、裝置失效就刪除", async () => {
  const { flushPushes } = await import("../src/api.ts");
  const { env, call } = setup();
  const vapid = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
  const jwk = JSON.stringify(await crypto.subtle.exportKey("jwk", vapid.privateKey));
  env.VAPID_PRIVATE_JWK = jwk;
  const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const p256dh = Buffer.from(new Uint8Array((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer)).toString("base64url");
  const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
  assert.ok(((await call<{ publicKey: string }>("amy", "GET", "/push/key")).data.publicKey ?? "").length > 80, "有公鑰");
  assert.equal((await call("amy", "POST", "/push/subscribe", { body: { endpoint: "https://push.example/abc", keys: { p256dh, auth } } })).status, 200);
  env.VAPID_PRIVATE_JWK = undefined; // 操作期間先不在背景自動推（測試用假的推播伺服器手動推）
  const { id } = (await call<{ id: string }>("admin1", "POST", "/activities", { body: { title: "推播測試" } })).data;
  await call("admin1", "PATCH", `/activities/${id}`, { body: { status: "open", joinApproval: true } });
  const code = (await call<ActivityView>("admin1", "GET", `/activities/${id}`)).data.activity.joinCode;
  await call("amy", "POST", `/join/${code}`);
  await call("admin1", "POST", `/activities/${id}/people/amy`, { body: { action: "approve" } }); // 產生「已加入作業」通知
  env.VAPID_PRIVATE_JWK = jwk;
  const sent: { url: string; headers: Record<string, string> }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    sent.push({ url, headers: init?.headers as Record<string, string> });
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  assert.equal(await flushPushes(env, fake), 1);
  assert.equal(sent[0].url, "https://push.example/abc");
  assert.match(sent[0].headers.authorization, /^vapid t=/);
  assert.equal(await flushPushes(env, fake), 0, "同一則不重複推");
  env.VAPID_PRIVATE_JWK = undefined;
  await call("admin1", "PATCH", `/activities/${id}`, { body: { status: "draft" } });
  await call("admin1", "PATCH", `/activities/${id}`, { body: { status: "open" } }); // 「作業開放了」通知
  env.VAPID_PRIVATE_JWK = jwk;
  const gone = (async () => new Response(null, { status: 410 })) as typeof fetch;
  await flushPushes(env, gone);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subs").first<{ n: number }>())!.n, 0, "失效的裝置刪除");
});

test("組長邀請、組長核准組員、活動結束備份提醒（含 Email）、一鍵下載備份壓縮檔", async () => {
  const { env, bucket, call } = setup();
  const sent: { to: string; subject: string }[] = [];
  env.EMAIL = { send: async (m) => void sent.push({ to: m.to, subject: m.subject }) };
  env.EMAIL_FROM = "noreply@learn.hglobal1985.com";
  env.CENTRAL_SERVICE_SECRET = "svc";
  const { setCentralFetch } = await import("../src/central.ts");
  setCentralFetch(async (url, init) => {
    if (url.endsWith("/v1/service/token")) return Response.json({ access_token: "t", expires_in: 600 });
    if (url.endsWith("/contacts/lookup")) {
      const ids = (JSON.parse(String(init?.body)) as { member_ids: string[] }).member_ids;
      return Response.json({ contacts: ids.map((m) => ({ member_id: m, email: `${m}@example.com` })) });
    }
    return new Response("{}", { status: 404 });
  });
  const { id } = (await call<{ id: string }>("admin1", "POST", "/activities", { body: { title: "美力之星", endsOn: "2020-01-01" } })).data;
  await call("admin1", "PATCH", `/activities/${id}`, { body: { status: "open", endsOn: "2099-01-01" } });
  assert.equal(retentionOf({ ends_on: "2026-12-31" }), "2027-03-03", "沒設定刪除日：結束日後 2 個月");
  assert.equal(retentionOf({ ends_on: "2026-12-31", retention_until: "2027-01-10" }), "2027-01-10");
  const g = (await call<{ id: string }>("admin1", "POST", `/activities/${id}/groups`, { body: { name: "台北一組" } })).data.id;
  // 組長邀請：只能老師以上發；接受後直接是組長
  assert.equal((await call("amy", "POST", `/activities/${id}/invites`, { body: { role: "leader", groupId: g } })).status, 403);
  const inv = (await call<{ code: string }>("admin1", "POST", `/activities/${id}/invites`, { body: { role: "leader", groupId: g } })).data.code;
  assert.equal((await call<{ role: string; groupName: string; valid: boolean }>("amy", "GET", `/invite/${inv}`)).data.groupName, "台北一組");
  assert.equal((await call<{ role: string }>("amy", "POST", `/invite/${inv}`)).data.role, "leader");
  assert.equal((await call("bob", "POST", `/invite/${inv}`)).status, 410, "只能一人使用");
  const view = (await call<PeopleView>("amy", "GET", `/activities/${id}/people`)).data;
  assert.ok(view.groups[0]!.members.some((m) => m.memberId === "amy" && m.isLeader));
  const groupCode = view.groups[0]!.joinCode!;
  // 組員用本組連結申請 → 組長收到通知、自己核准
  assert.equal((await call<{ status: string }>("bob", "POST", `/join/${groupCode}`)).data.status, "pending");
  assert.ok((await call<{ title: string }[]>("amy", "GET", "/notices")).data.some((n) => n.title === "有人申請加入"));
  assert.equal((await call<PeopleView>("amy", "GET", `/activities/${id}/people`)).data.pending.length, 1);
  assert.equal((await call("amy", "POST", `/activities/${id}/people/bob`, { body: { action: "approve" } })).status, 200);
  assert.equal((await call("cat", "POST", `/activities/${id}/people/bob`, { body: { action: "approve" } })).status, 403);

  // 繳交一些作業
  const l = (await call<{ id: string }>("admin1", "POST", `/activities/${id}/lessons`, { body: { title: "第一堂" } })).data.id;
  const it = (await call<{ id: string }>("admin1", "POST", `/lessons/${l}/items`, { body: { name: "照片", kinds: ["photo", "text"] } })).data.id;
  for (const n of ["a.jpg", "a.jpg"]) assert.equal((await call("bob", "POST", `/items/${it}/files?kind=photo&name=${n}`, { bytes: jpeg })).status, 200);
  assert.equal(bucket.keys().length, 2);

  // 一鍵下載備份：自己的、全部的（學員不能下載全部）
  const mine = (await call<{ parts: { url: string; files: number }[] }>("bob", "GET", `/activities/${id}/backup`)).data;
  assert.equal(mine.parts.length, 1);
  assert.equal(mine.parts[0]!.files, 2);
  const zip = await handleZip(new Request(`https://check.test${mine.parts[0]!.url}`), env);
  assert.equal(zip.headers.get("content-type"), "application/zip");
  const bytes = new Uint8Array(await zip.arrayBuffer());
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50, "是 ZIP 檔");
  assert.ok(new TextDecoder().decode(bytes).includes("美力之星/第一堂/照片/a (2).jpg"), "重複檔名自動加 (2)");
  const allByStudent = (await call<{ parts: { url: string }[] }>("bob", "GET", `/activities/${id}/backup?all=1`)).data;
  const z2 = new TextDecoder().decode(new Uint8Array(await (await handleZip(new Request(`https://check.test${allByStudent.parts[0]!.url}`), env)).arrayBuffer()));
  assert.ok(z2.includes("_我的作業") || !z2.includes("學員_"), "學員只拿得到自己的");
  assert.equal((await handleZip(new Request("https://check.test/z/nope"), env)).status, 410);

  // 活動結束隔天：站內通知＋Email 通知全體（管理員連到全部、學員連到自己的）；不重複
  await call("admin1", "PATCH", `/activities/${id}`, { body: { endsOn: "2020-01-01" } });
  await call("admin1", "PATCH", `/activities/${id}`, { body: { retentionUntil: "2099-12-31" } });
  await scheduled(env);
  const nb = (await call<{ title: string; link: string }[]>("bob", "GET", "/notices")).data.find((n) => n.title.includes("請下載作業備份"));
  assert.ok(nb && nb.link === `/files/${id}`);
  const na = (await call<{ title: string; link: string }[]>("admin1", "GET", "/notices")).data.find((n) => n.title.includes("請下載作業備份"));
  assert.ok(na && na.link === `/files/${id}?all=1`);
  assert.ok(sent.some((m) => m.to === "bob@example.com") && sent.some((m) => m.to === "amy@example.com"), "Email 也寄了");
  const count = sent.length;
  await scheduled(env);
  assert.equal(sent.length, count, "不重複寄");
});
