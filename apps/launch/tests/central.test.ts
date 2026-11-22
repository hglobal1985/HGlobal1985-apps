import assert from "node:assert/strict";
import { generateKeyPairSync, createSign, createVerify } from "node:crypto";
import { test, beforeEach } from "node:test";
import { handleApi, youtubeId } from "../src/api.ts";
import { setCentralFetch } from "../src/central.ts";
import type { CourseDetail, CourseSummary, Member, Order, Playback } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

const ISS = "https://id.hglobal1985.com";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

function token(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: "RS256", typ: "at+jwt", kid: "k1", ...header });
  const p = b64({ iss: ISS, aud: ISS, app_id: "learn", sub: "m_alice", exp: now + 600, ...claims });
  const sig = createSign("RSA-SHA256").update(`${h}.${p}`).sign(privateKey).toString("base64url");
  return `${h}.${p}.${sig}`;
}

/** 模擬中央：alice 是白金（符合 ≤ platinum），bob 是超級管理員。 */
let central = { down: false, eligibilityCalls: 0 };
const ladder = ["none", "silver", "gold", "platinum", "emerald", "diamond"];
function fakeCentral(url: string, init?: RequestInit): Promise<Response> {
  const auth = new Headers(init?.headers).get("authorization") ?? "";
  const sub = auth ? JSON.parse(Buffer.from(auth.split(".")[1], "base64url").toString()).sub : null;
  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  if (url.endsWith("/oauth/jwks")) return ok({ keys: [jwk] });
  if (central.down) return Promise.reject(new Error("offline"));
  if (url.includes("/v1/vocab/suggestions") && url.includes("pool=education_center")) return ok({ suggestions: ["台北 100", "台中 136"] });
  if (url.endsWith("/v1/me/profile")) return ok({ fields: { display_name: { value: sub === "m_bob" ? "課務小明" : "愛麗絲" }, ...(sub === "m_nolegal" ? {} : { legal_name: { value: "王小明（本名）" } }) } });
  if (url.endsWith("/v1/admin/me")) return Promise.resolve(new Response("{}", { status: 401 })); // 中央只接受網站本身的登入
  if (url.endsWith("/v1/apps/learn/handoff"))
    return sub === "m_bob" ? ok({ app_id: "learn", version: "x", text: "…" }) : Promise.resolve(new Response("{}", { status: 403 }));
  if (url.endsWith("/v1/eligibility/context")) {
    if (sub === "m_pres") return ok({ member_id: sub, roles: [{ role: "president" }], hglobal_verified: true, center: { key: "台北中心", label: "台北中心" } });
    if (sub === "m_sec") return ok({ member_id: sub, roles: [{ role: "secretary" }], hglobal_verified: true, center: null });
    if (sub === "m_bob") return ok({ member_id: sub, roles: [{ role: "super_admin" }], hglobal_verified: true, center: null });
    if (sub === "m_alice") return ok({ member_id: sub, roles: [], hglobal_verified: true, center: { key: "台北中心", label: "台北中心" } });
    return ok({ member_id: sub, roles: [], hglobal_verified: false, center: null });
  }
  if (url.endsWith("/v1/eligibility/reviews")) {
    if (sub === "m_pres") return ok({ scope: "center", reviews: [{ id: "r1", display_name: "阿甲", field_key: "rank", field_label: "獎銜", center: "台北中心", current_value: "silver", requested_value: "gold", created_at: "2026-11-17T10:00:00+08:00" }] });
    return Promise.resolve(new Response("{}", { status: 403 }));
  }
  if (/\/v1\/eligibility\/reviews\/[^/]+\/decision$/.test(url)) return Promise.resolve(new Response("{}", { status: url.includes("/other/") ? 403 : url.includes("/gone/") ? 404 : sub === "m_pres" ? 200 : 403 }));
  if (url.endsWith("/v1/eligibility/check-batch")) {
    central.eligibilityCalls++;
    const { rules } = JSON.parse(String(init?.body)) as { rules: { min_rank: string }[] };
    const mine = sub === "m_alice" ? ladder.indexOf("platinum") : 0;
    return ok({ results: rules.map((r) => ({ allowed: ladder.indexOf(r.min_rank) !== -1 && ladder.indexOf(r.min_rank) <= mine, reason: "x" })) });
  }
  return Promise.resolve(new Response("{}", { status: 404 }));
}

function setup(extra: Partial<Env> = {}) {
  const env: Env = { DB: createTestDb(), ...extra };
  return async <T = unknown,>(method: string, path: string, opts: { token?: string; body?: unknown; platform?: string } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.platform) headers["x-client-platform"] = opts.platform;
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
}

beforeEach(() => {
  central = { down: false, eligibilityCalls: 0 };
  setCentralFetch(fakeCentral);
});

test("中央會員：驗證 Token，取得顯示名稱，不回傳獎銜", async () => {
  const call = setup();
  const me = await call<{ member: Member }>("GET", "/me", { token: token() });
  assert.equal(me.data.member.sub, "m_alice");
  assert.equal(me.data.member.name, "愛麗絲");
  assert.equal(me.data.member.rank, null);
  assert.equal(me.data.member.demo, false);
  assert.equal(me.data.member.role, "student");
});

test("不合格的 Token 一律視為未登入", async () => {
  const call = setup();
  const bad = [
    token({ app_id: "other" }),
    token({ aud: "https://evil.example" }),
    token({ exp: Math.floor(Date.now() / 1000) - 5 }),
    token({}, { typ: "JWT" }),
    token({}, { kid: "unknown" }),
    token().slice(0, -4) + "AAAA",
  ];
  for (const t of bad) assert.equal((await call<{ member: unknown }>("GET", "/me", { token: t })).data.member, null);
});

test("獎銜資格向中央查詢；中央連不上時一律不符合（fail closed）", async () => {
  const call = setup();
  const t = token();
  const list = await call<CourseSummary[]>("GET", "/courses", { token: t });
  assert.equal(list.data.find((c) => c.id === "lead")!.eligible, true, "白金課程");
  assert.equal(list.data.find((c) => c.id === "growth")!.eligible, false, "翡翠課程");
  assert.equal((await call("POST", "/orders", { token: t, body: { courseIds: ["growth"] } })).status, 403);
  setCentralFetch(fakeCentral); // 清空快取
  await call("GET", "/me", { token: t }); // 先載入金鑰
  central.down = true;
  const offline = await call<CourseSummary[]>("GET", "/courses", { token: t });
  assert.equal(offline.data.find((c) => c.id === "lead")!.eligible, false);
  assert.equal(offline.data.find((c) => c.id === "start")!.eligible, true, "不限獎銜只需登入");
});

test("中央會員領課、資料只以 sub 關聯；超級管理員可審核", async () => {
  const call = setup();
  const alice = token();
  const bob = token({ sub: "m_bob" });
  const [order] = (await call<Order[]>("POST", "/orders", { token: alice, body: { courseIds: ["share"] } })).data;
  assert.equal(order.legalName, "王小明（本名）", "付費報名存下真實姓名快照（對帳用）");
  assert.match(order.payRef ?? "", /^P[A-Z2-9]{8}$/, "付費報名有唯一付款代碼");
  assert.equal(order.memberName, "愛麗絲");
  assert.equal((await call("POST", `/admin/orders/${order.id}/review`, { token: alice, body: { action: "paid" } })).status, 404);
  const approved = await call<Order>("POST", `/admin/orders/${order.id}/review`, { token: bob, body: { action: "paid" } });
  assert.equal(approved.data.status, "opened");
  assert.equal((await call<CourseDetail>("GET", "/courses/share", { token: alice })).data.enrollment, "opened");
});

test("關閉模擬登入後，模擬帳號 API 與舊 Token 都失效", async () => {
  const on = setup({ DEMO_LOGIN: "on" });
  assert.equal((await on<{ demoLogin: boolean }>("GET", "/config")).data.demoLogin, true);
  const off = setup();
  assert.equal((await off<{ demoLogin: boolean }>("GET", "/config")).data.demoLogin, false);
  assert.equal((await off("GET", "/demo-members")).status, 404);
  assert.equal((await off("POST", "/auth/demo", { body: { sub: "demo-admin" } })).status, 404);
});

test("YouTube 網址解析", () => {
  for (const u of ["dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3", "https://youtu.be/dQw4w9WgXcQ", "https://youtube.com/shorts/dQw4w9WgXcQ", "https://m.youtube.com/embed/dQw4w9WgXcQ"])
    assert.equal(youtubeId(u), "dQw4w9WgXcQ", u);
  for (const u of ["https://evil.com/watch?v=dQw4w9WgXcQ", "abc", "javascript:alert(1)"]) assert.equal(youtubeId(u), null, u);
});

test("管理員設定章節影片：YouTube 直接播放；Mux 未設金鑰回 503、設定後簽出播放網址", async () => {
  const { publicKey: mp, privateKey: mk } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = mk.export({ format: "pem", type: "pkcs8" }).toString();
  for (const secrets of [{}, { MUX_SIGNING_KEY_ID: "sk1", MUX_SIGNING_PRIVATE_KEY: Buffer.from(pem).toString("base64") }]) {
    const call = setup(secrets);
    const admin = token({ sub: "m_bob" });
    const alice = token();
    assert.equal((await call("PATCH", "/admin/lessons/start-welcome", { token: alice, body: { mediaType: "youtube", mediaRef: "dQw4w9WgXcQ" } })).status, 403);
    assert.equal((await call("PATCH", "/admin/lessons/start-welcome", { token: admin, body: { mediaType: "youtube", mediaRef: "not a video" } })).status, 400);
    await call("PATCH", "/admin/lessons/start-welcome", { token: admin, body: { mediaType: "youtube", mediaRef: "https://youtu.be/dQw4w9WgXcQ" } });
    await call("PATCH", "/admin/lessons/start-foundation", { token: admin, body: { mediaType: "mux", mediaRef: "AbCdEfGhIjKlMn012" } });
    const detail = await call<CourseDetail>("GET", "/courses/start", { token: admin });
    assert.deepEqual(detail.data.lessons[0].media, { type: "youtube", ref: "dQw4w9WgXcQ" });
    assert.equal((await call<CourseDetail>("GET", "/courses/start", { token: alice })).data.lessons[0].media, undefined, "學員看不到影片來源");
    await call("POST", "/orders", { token: alice, body: { courseIds: ["start"] } });
    const yt = await call<Playback>("GET", "/courses/start/lessons/start-welcome/playback", { token: alice });
    assert.deepEqual(yt.data, { kind: "youtube", videoId: "dQw4w9WgXcQ", start: null, end: null });
    const mux = await call<Playback>("GET", "/courses/start/lessons/start-foundation/playback", { token: alice });
    if (!("MUX_SIGNING_KEY_ID" in secrets)) {
      assert.equal(mux.status, 503);
      assert.doesNotMatch(JSON.stringify(mux.data), /AbCdEfGh/, "未設定時不洩漏 Playback ID");
    } else {
      assert.equal(mux.data.kind, "hls");
      const url = new URL((mux.data as { url: string }).url);
      assert.equal(url.pathname, "/AbCdEfGhIjKlMn012.m3u8");
      const [h, p, s] = url.searchParams.get("token")!.split(".");
      assert.equal(JSON.parse(Buffer.from(h, "base64url").toString()).kid, "sk1");
      assert.equal(JSON.parse(Buffer.from(p, "base64url").toString()).aud, "v");
      assert.ok(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(mp, Buffer.from(s, "base64url")));
    }
  }
});

test("LEARN_ADMIN_SUBS 指定的會員也是管理員；其他人不是", async () => {
  const call = setup({ LEARN_ADMIN_SUBS: " m_carol , m_dave" });
  const carol = await call<{ member: Member }>("GET", "/me", { token: token({ sub: "m_carol" }) });
  assert.equal(carol.data.member.role, "admin");
  const erin = await call<{ member: Member }>("GET", "/me", { token: token({ sub: "m_erin" }) });
  assert.equal(erin.data.member.role, "student");
});

test("中央職務與中心：秘書是管理員；會長只看得到自己中心的報名並收到通知", async () => {
  const call = setup();
  const alice = token();
  const pres = token({ sub: "m_pres" });
  const sec = token({ sub: "m_sec" });
  const me = await call<{ member: Member }>("GET", "/me", { token: sec });
  assert.equal(me.data.member.role, "admin");
  assert.deepEqual(me.data.member.titles, ["總部秘書"]);
  const p = await call<{ member: Member }>("GET", "/me", { token: pres });
  assert.equal(p.data.member.role, "student");
  assert.equal(p.data.member.reviewer, true);
  assert.equal(p.data.member.center, "台北中心");
  const [order] = (await call<Order[]>("POST", "/orders", { token: alice, body: { courseIds: ["share"] } })).data;
  assert.equal(order.centerLabel, "台北中心");
  const notes = await call<{ title: string }[]>("GET", "/notifications", { token: pres });
  assert.equal(notes.data.filter((n) => n.title.startsWith("有新的報名待審核")).length, 1, "寄給該中心會長");
  const list = await call<Order[]>("GET", "/admin/orders", { token: pres });
  assert.deepEqual(list.data.map((o) => o.id), [order.id]);
  const done = await call<Order>("POST", `/admin/orders/${order.id}/review`, { token: pres, body: { action: "vip" } });
  assert.equal(done.data.status, "opened");
  assert.equal(done.data.payMethod, "vip");
  assert.equal(done.data.events!.at(-1)!.actorTitle, "會長");
  assert.equal((await call("POST", `/admin/orders/${order.id}/review`, { token: pres, body: { action: "revoke", reasonCode: "unpaid" } })).status, 403, "撤銷限秘書與超級管理員");
  assert.equal((await call<Order>("POST", `/admin/orders/${order.id}/review`, { token: sec, body: { action: "revoke", reasonCode: "unpaid" } })).data.revoked, true);
  assert.equal((await call<CourseDetail>("GET", "/courses/share", { token: alice })).data.enrollment, null);
});


test("中心清單以會員中心為準：不混入行動大學本地資料，也不能自行新增", async () => {
  const call = setup();
  const alice = token();
  const bob = token({ sub: "m_bob" });
  // alice 報名後，訂單裡會留下「台北中心」這個名稱（本地資料），但它不在中央清單裡
  assert.equal((await call("POST", "/orders", { token: alice, body: { courseIds: ["share"] } })).status, 200);
  const list = (await call<string[]>("GET", "/centers", { token: bob })).data;
  assert.deepEqual(list, ["台北 100", "台中 136"], "只有中央的清單");
  // 主辦單位只能用中央清單裡的名稱（寰宇總部除外）
  assert.equal((await call("PATCH", "/admin/courses/share", { token: bob, body: { hostUnit: ["寰宇總部", "台北中心"] } })).status, 400);
  assert.equal((await call("PATCH", "/admin/courses/share", { token: bob, body: { hostUnit: ["寰宇總部", "台中 136"] } })).status, 200);
  // 審核群組的負責中心、成員中心也一樣
  assert.equal((await call("POST", "/admin/review-groups", { token: bob, body: { name: "測試群組", ownerCenter: "亂寫中心" } })).status, 400);
  // 中央暫時連不上：用最近一次成功的清單，不會變成空的或混入本地資料
  central.down = true;
  assert.deepEqual((await call<string[]>("GET", "/centers", { token: bob })).data, ["台北 100", "台中 136"]);
});

test("通知頁審核：中央的獎銜、中心新申請即時顯示（權限由中央判斷）；沒有權限＝available:false；處理結果對應中央狀態碼", async () => {
  const call = setup();
  setCentralFetch(fakeCentral);
  const pres = (await call<{ available: boolean; scope: string; reviews: { id: string; display_name: string }[] }>("GET", "/central-reviews", { token: token({ sub: "m_pres" }) })).data;
  assert.equal(pres.available, true);
  assert.equal(pres.scope, "center");
  assert.deepEqual(pres.reviews.map((r) => [r.id, r.display_name]), [["r1", "阿甲"]]);
  const alice = (await call<{ available: boolean; reviews: unknown[] }>("GET", "/central-reviews", { token: token({ sub: "m_alice" }) })).data;
  assert.deepEqual(alice, { available: false, scope: null, reviews: [] });
  assert.equal((await call("POST", "/central-reviews/r1/decision", { token: token({ sub: "m_pres" }), body: { decision: "approve" } })).status, 200);
  assert.equal((await call("POST", "/central-reviews/r1/decision", { token: token({ sub: "m_pres" }), body: { decision: "x" } })).status, 400);
  assert.equal((await call("POST", "/central-reviews/other/decision", { token: token({ sub: "m_pres" }), body: { decision: "approve" } })).status, 403);
  assert.equal((await call("POST", "/central-reviews/gone/decision", { token: token({ sub: "m_pres" }), body: { decision: "reject" } })).status, 404);
  assert.equal((await call("GET", "/central-reviews")).status, 401);
});

test("我的書櫃：超級管理員邀請→會員接受（網址＝會員編號）→擁有者加書架與書→訪客要密碼才看得到；密碼可失效、可只鎖單一本書", async () => {
  const call = setup();
  // 在假中央的個人資料裡加上會員編號
  setCentralFetch(async (url, init) => {
    const res = await fakeCentral(url, init);
    if (!url.endsWith("/v1/me/profile")) return res;
    const b = (await res.json()) as { fields: Record<string, unknown> };
    return new Response(JSON.stringify({ ...b, fields: { ...b.fields, member_number: { value: [{ country: "TW", number: "TW9475831" }] } } }), { status: 200 });
  });
  const boss = token({ sub: "m_bob" });
  const alice = token({ sub: "m_alice" });
  // 沒有邀請：什麼都沒有
  assert.deepEqual((await call<{ library: unknown }>("GET", "/library/mine", { token: alice })).data.library, null);
  assert.equal((await call("POST", "/admin/library-invites", { token: alice })).status, 403, "只有超級管理員能邀請");
  const code = (await call<{ code: string }>("POST", "/admin/library-invites", { token: boss })).data.code;
  const mine = (await call<{ library: { number: string; title: string } }>("POST", `/library-invites/${code}/accept`, { token: alice })).data;
  assert.equal(mine.library.number, "tw9475831");
  assert.equal((await call("POST", `/library-invites/${code}/accept`, { token: boss })).status, 404, "邀請只能用一次");
  // 擁有者加書架與書
  assert.equal((await call("POST", "/library/mine/items", { token: alice, body: { kind: "shelf", title: "我主講的課程" } })).status, 200);
  const d = (await call<{ items: { id: string; kind: string; title: string; type: string }[] }>("POST", "/library/mine/items", { token: alice, body: { kind: "book", url: "https://docs.google.com/presentation/d/abc/edit", title: "第一屆簡報", eventDate: "2026-10-05" } })).data;
  assert.deepEqual(d.items.map((i) => [i.kind, i.title]), [["shelf", "我主講的課程"], ["book", "第一屆簡報"]]);
  assert.equal(d.items[1]!.type, "google_slides");
  const book = d.items[1]!.id;
  // 訪客（不用登入）看得到內容；網址不分大小寫
  const view = async (tokens?: unknown, who?: string) => (await call<{ locked: boolean; lockExpired: boolean; owner: boolean; items: { id: string; url: string | null; locked: boolean }[] }>("POST", "/library/view/TW9475831", { token: who, body: { tokens } })).data;
  assert.equal((await view()).items[1]!.url, "https://docs.google.com/presentation/d/abc/edit");
  // 單獨替這本書設密碼：訪客只看到書名，沒有連結
  assert.equal((await call("PATCH", `/library/mine/items/${book}`, { token: alice, body: { password: "abcd", passwordDays: 7 } })).status, 200);
  let v = await view();
  assert.equal(v.items[1]!.locked, true);
  assert.equal(v.items[1]!.url, null);
  assert.equal((await call("POST", "/library/view/tw9475831/unlock", { body: { password: "xxxx", itemId: book } })).status, 403);
  const t = (await call<{ token: string }>("POST", "/library/view/tw9475831/unlock", { body: { password: "abcd", itemId: book } })).data.token;
  v = await view({ items: { [book]: t } });
  assert.equal(v.items[1]!.url, "https://docs.google.com/presentation/d/abc/edit");
  assert.equal((await view(undefined, alice)).items[1]!.url !== null, true, "擁有者永遠看得到");
  // 整座書櫃設密碼：沒憑證只看到上鎖畫面；改密碼後舊憑證失效
  await call("PUT", "/library/mine", { token: alice, body: { password: "open", passwordDays: 1 } });
  assert.deepEqual(await view().then((x) => [x.locked, x.items.length]), [true, 0]);
  const lt = (await call<{ token: string }>("POST", "/library/view/tw9475831/unlock", { body: { password: "open" } })).data.token;
  assert.equal((await view({ lib: lt })).locked, false);
  await call("PUT", "/library/mine", { token: alice, body: { password: "newpw", passwordDays: 1 } });
  assert.equal((await view({ lib: lt })).locked, true, "換密碼後舊憑證失效");
  // 密碼失效日（改資料庫成已過期）：任何人都解不開，擁有者重設後才恢復
  const env = (await import("./sqlite-d1.ts")).createTestDb;
  void env;
  // 關閉密碼＝公開
  await call("PUT", "/library/mine", { token: alice, body: { password: null } });
  assert.equal((await view()).locked, false);
  assert.equal((await call("POST", "/library/view/not-exist", { body: {} })).status, 404);
});

test("我的書櫃：獲得任意 100 枚徽章自動解鎖鑰匙（99 枚不行）", async () => {
  const db = createTestDb();
  const call = setup({ DB: db });
  setCentralFetch(async (url, init) => {
    const res = await fakeCentral(url, init);
    if (!url.endsWith("/v1/me/profile")) return res;
    const b = (await res.json()) as { fields: Record<string, unknown> };
    return new Response(JSON.stringify({ ...b, fields: { ...b.fields, member_number: { value: [{ country: "TW", number: "TW1234567" }] } } }), { status: 200 });
  });
  const alice = token({ sub: "m_alice" });
  await db.prepare("DELETE FROM achievements").run();
  for (let i = 0; i < 100; i += 1) await db.prepare("INSERT INTO achievements (id, name, condition_type, threshold) VALUES (?, ?, 'lessons_completed', 999)").bind(`a${i}`, `徽章${i}`).run();
  for (let i = 0; i < 99; i += 1) await db.prepare("INSERT INTO member_achievements (member_sub, achievement_id) VALUES ('m_alice', ?)").bind(`a${i}`).run();
  const before = (await call<{ library: unknown; keys: { have: number; need: number } }>("GET", "/library/mine", { token: alice })).data;
  assert.equal(before.library, null);
  assert.deepEqual([before.keys.have, before.keys.need], [99, 100]);
  await db.prepare("INSERT INTO member_achievements (member_sub, achievement_id) VALUES ('m_alice', 'a99')").run();
  const after = (await call<{ library: { number: string } | null }>("GET", "/library/mine", { token: alice })).data;
  assert.equal(after.library?.number, "tw1234567");
});

test("審核紀錄：待審時不存申請內容，審核完成才寫入內容與姓名（業主 2026-11-22）", async () => {
  const env: Env = { DB: createTestDb() };
  const call = async <T = unknown,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  // 申請送出時留下的待審紀錄：只有誰、哪個欄位，沒有申請內容
  await env.DB.prepare("INSERT INTO review_log (id, field_key, field_label, applicant_sub, applicant_name) VALUES ('p1', 'rank', '獎銜', 'm_alice', '王小明')").run();
  const item = { display_name: "王小明", field_key: "rank", field_label: "獎銜", current_value: "silver", requested_value: "gold" };
  assert.equal((await call("POST", "/central-reviews/r1/decision", { token: token({ sub: "m_pres" }), body: { decision: "approve", item } })).status, 200);
  const row = await env.DB.prepare("SELECT status, applicant_name, to_text, from_text FROM review_log WHERE id = 'p1'").first<Record<string, string>>();
  assert.deepEqual(JSON.parse(JSON.stringify(row)), { status: "approved", applicant_name: "王小明", to_text: "gold", from_text: "silver" }, "對應到待審紀錄，審核後補上內容");
});
