import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import { shareMessage, DEFAULT_SHARE_SETTINGS, type CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { cleanFetchedTitle, extractTitle, fetchLinkTitle, isPublicHost } from "../src/link-title.ts";
import { createTestDb } from "./sqlite-d1.ts";

function setup() {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub })).data.token;
  return { call, login };
}

test("連結名稱抓取：只連公開 https 網站；讀 og:title 或 <title>；登入頁標題不採用；轉址到內網會擋", async () => {
  assert.equal(isPublicHost(new URL("https://example.com/x")), true);
  for (const bad of ["http://example.com", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://[::1]/x", "https://intranet/x", "https://printer.local/x"]) assert.equal(isPublicHost(new URL(bad)), false, bad);
  assert.equal(extractTitle('<head><title> 我的&amp;教材 </title></head>'), "我的&教材");
  assert.equal(extractTitle('<meta property="og:title" content="簡報 &quot;A&quot;"><title>別的</title>'), '簡報 "A"', "og:title 優先");
  assert.equal(cleanFetchedTitle("Sign in"), null);
  assert.equal(cleanFetchedTitle("Google Docs"), null);
  assert.equal(cleanFetchedTitle("  好教材  "), "好教材");

  const html = (t: string) => new Response(`<html><head><title>${t}</title></head><body></body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  assert.equal(await fetchLinkTitle(new URL("https://example.com/a"), (async () => html("範例標題")) as unknown as typeof fetch), "範例標題");
  const redirectToPrivate = (async (u: string) => (String(u).includes("example.com") ? new Response(null, { status: 302, headers: { location: "https://127.0.0.1/secret" } }) : html("不該讀到"))) as unknown as typeof fetch;
  assert.equal(await fetchLinkTitle(new URL("https://example.com/a"), redirectToPrivate), null, "轉址到內網位址不跟隨");
  const yt = (async (u: string) => (String(u).includes("oembed") ? new Response(JSON.stringify({ title: "影片標題" }), { status: 200 }) : html("x"))) as unknown as typeof fetch;
  assert.equal(await fetchLinkTitle(new URL("https://youtu.be/dQw4w9WgXcQ"), yt), "影片標題", "YouTube 走 oEmbed");
  assert.equal(await fetchLinkTitle(new URL("https://example.com/a"), (async () => new Response("x", { status: 404 })) as unknown as typeof fetch), null);
});

test("其他教材（外部連結）：新增＝名稱＋連結一次建立、類型給所有人、網址只給有權限的人、修改會取代連結、名稱空白自動抓取", async () => {
  const { call, login } = setup();
  const [admin, student, outsider] = await Promise.all([login("demo-admin"), login("demo-student"), login("demo-outsider")]);
  const orig = globalThis.fetch;
  globalThis.fetch = (async (u: string) => (String(u).includes("canva.com") ? new Response("<title>我的簡報</title>", { status: 200, headers: { "content-type": "text/html" } }) : new Response(null, { status: 404 }))) as unknown as typeof fetch;
  try {
    const made = (await call<CourseDetail>("POST", "/admin/courses", admin, { title: "教材測試", teacher: "王", hostUnit: "寰宇總部", status: "published", isPublic: true, priceTwd: 0 })).data;
    // 名稱空白 → 自動抓
    const r1 = await call<CourseDetail>("POST", `/admin/courses/${made.id}/materials`, admin, { url: "https://www.canva.com/design/abc/view", title: "" });
    assert.equal(r1.status, 200);
    const m1 = r1.data.lessons.find((l) => l.material)!;
    assert.deepEqual([m1.title, m1.linkType, m1.ready], ["我的簡報", "canva", true]);
    // 抓不到 → 類型預設名稱；自己填的名稱優先
    const r2 = await call<CourseDetail>("POST", `/admin/courses/${made.id}/materials`, admin, { url: "https://forms.gle/xyz" });
    assert.equal(r2.data.lessons.filter((l) => l.material)[0]!.title, "Google 表單");
    const r3 = await call<CourseDetail>("POST", `/admin/courses/${made.id}/materials`, admin, { url: "https://notion.so/p", title: "我取的名字" });
    assert.equal(r3.data.lessons.filter((l) => l.material)[0]!.title, "我取的名字");
    assert.equal((await call("POST", `/admin/courses/${made.id}/materials`, admin, { url: "http://insecure.com/x" })).status, 400, "只收 https");
    assert.equal((await call("POST", `/admin/courses/${made.id}/materials`, student, { url: "https://a.com/x" })).status, 403, "學員不能新增");

    // 公開免費課程：會員看得到網址；訪客（未登入）也看得到（完全公開）
    const asStudent = (await call<CourseDetail>("GET", `/courses/${made.id}`, student)).data.lessons.find((l) => l.id === m1.id)!;
    assert.deepEqual([asStudent.linkType, asStudent.linkUrl], ["canva", "https://www.canva.com/design/abc/view"]);
    // 付費課程：未開通的人只拿得到類型，拿不到網址
    const paid = (await call<CourseDetail>("POST", "/admin/courses", admin, { title: "付費教材", teacher: "王", hostUnit: "寰宇總部", status: "published", priceTwd: 500 })).data;
    const pm = (await call<CourseDetail>("POST", `/admin/courses/${paid.id}/materials`, admin, { url: "https://www.canva.com/design/zzz/view", title: "付費講義" })).data.lessons.find((l) => l.material)!;
    const locked = (await call<CourseDetail>("GET", `/courses/${paid.id}`, outsider)).data.lessons.find((l) => l.id === pm.id)!;
    assert.deepEqual([locked.locked, locked.linkType, locked.linkUrl], [true, "canva", undefined], "未開通：只有類型、沒有網址");

    // 修改：換連結、改名稱
    const upd = await call<CourseDetail>("PUT", `/admin/lessons/${m1.id}/material`, admin, { url: "https://docs.google.com/presentation/d/1/edit", title: "新名稱" });
    const u1 = upd.data.lessons.find((l) => l.id === m1.id)!;
    assert.deepEqual([u1.title, u1.linkType, u1.linkUrl], ["新名稱", "google_slides", "https://docs.google.com/presentation/d/1/edit"]);
    assert.equal((await call("PUT", `/admin/lessons/${made.lessons[0]!.id}/material`, admin, { url: "https://a.com/x", title: "x" })).status, 400, "章節不能當教材連結修改");

    // 連結名稱查詢：只有管理者
    assert.equal((await call("GET", `/admin/link-title?url=${encodeURIComponent("https://www.canva.com/design/abc/view")}`, student)).status, 403);
    const lt = await call<{ type: string; title: string | null; defaultTitle: string }>("GET", `/admin/link-title?url=${encodeURIComponent("https://www.canva.com/design/abc/view")}`, admin);
    assert.deepEqual([lt.data.type, lt.data.title, lt.data.defaultTitle], ["canva", "我的簡報", "Canva 簡報"]);
  } finally {
    globalThis.fetch = orig;
  }
});

test("教材分享文字：可用 {教材名稱}、{課程名稱}、{主講人}、{職稱}，後面接引導文字與外部連結", () => {
  const S = DEFAULT_SHARE_SETTINGS;
  assert.equal(shareMessage(S, "https://x.com/doc", { teacher: "王", title: "翡翠班" }, { title: "講義A" }), "我推薦你看這份教材：講義A（翡翠班）\n\n按此開啟網址 👉\nhttps://x.com/doc");
  const custom = { ...S, materialText: "{主講人}{職稱}的教材《{教材名稱}》" };
  assert.equal(shareMessage(custom, "u", { teacher: "王", teacherTitle: "經理", title: "T" }, { title: "N" }).split("\n")[0], "王 經理的教材《N》");
});

test("章節分享文字：姓名、職稱、章節名稱取章節自己的設定（不用課程的）；章節沒填分享者用「老師」；課程名稱取所屬課程", () => {
  const S = DEFAULT_SHARE_SETTINGS;
  const course = { teacher: "課程主講", teacherTitle: "課程職稱", title: "翡翠班" };
  assert.equal(shareMessage(S, "https://u/c?lesson=1", course, undefined, { sharer: "李華", sharerTitle: "白金經理", title: "第2堂 溝通" }), "我剛聽完這場 李華 白金經理的這場精彩演講 第2堂 溝通 我就立刻想到要分享給你！\n\n按此開啟網址 👉\nhttps://u/c?lesson=1");
  const noTitle = shareMessage(S, "u", course, undefined, { sharer: "李華", sharerTitle: "", title: "X" }).split("\n")[0];
  assert.equal(noTitle?.includes("課程"), false, "沒填章節分享者職稱：省略，不會借用課程的職稱");
  assert.match(shareMessage(S, "u", course, undefined, { sharer: "", title: "X" }), /這場 老師的/, "沒填分享者＝老師，不借用課程主講人");
  const custom = { ...S, chapterText: "《{章節名稱}》出自「{課程名稱}」，講者 {主講人}{職稱}" };
  assert.equal(shareMessage(custom, "u", course, undefined, { sharer: "李華", sharerTitle: "經理", title: "T" }).split("\n")[0], "《T》出自「翡翠班」，講者 李華 經理");
});

test("連結日期：讀 datePublished／uploadDate／article:published_time，不合理的日期不採用", async () => {
  const { extractDate, fetchLinkInfo } = await import("../src/link-title.ts");
  assert.equal(extractDate('<meta itemprop="datePublished" content="2026-10-21T10:00:00-07:00">'), "2026-10-21");
  assert.equal(extractDate('<meta property="article:published_time" content="2025-03-02T08:00:00+08:00"/>'), "2025-03-02");
  assert.equal(extractDate('<script type="application/ld+json">{"datePublished":"2024-12-31T00:00:00Z"}</script>'), "2024-12-31");
  assert.equal(extractDate('<meta itemprop="datePublished" content="2999-01-01">'), null);
  assert.equal(extractDate("<html></html>"), null);
  const f = (async () => new Response('<head><title>文章</title><meta property="article:published_time" content="2026-01-05T00:00:00Z"></head>', { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
  assert.deepEqual(await fetchLinkInfo(new URL("https://example.com/a"), f), { title: "文章", date: "2026-01-05" });
});

import { extractDate as extractDateYt } from "../src/link-title.ts";
test("YouTube 影片頁：發布日期在 </head> 之後的 itemprop 或 JSON 也讀得到", () => {
  assert.equal(extractDateYt('<html><head><title>x</title></head><body><div itemscope><meta itemprop="datePublished" content="2024-03-25T06:57:33-07:00"></div>'), "2024-03-25");
  assert.equal(extractDateYt('<script>var a={"publishDate":"2026-02-10T10:00:00-08:00","x":1}</script>'), "2026-02-10");
});
