import assert from "node:assert/strict";
import { test } from "node:test";
import type { Env } from "../src/d1.ts";
import { centerShareName, withShareMeta } from "../src/og.ts";
import { createWorker } from "../src/worker.ts";
import { createTestDb } from "./sqlite-d1.ts";

const html = '<!doctype html><html><head><title>寰宇行動大學</title></head><body><noscript> You need to enable JavaScript to run this app. </noscript><div id="root"></div></body></html>';
const files = { "/index.html": { type: "text/html; charset=utf-8", data: btoa(unescape(encodeURIComponent(html))) } };

test("分享預覽：短網址標題＝名稱 | 寰宇行動大學，說明＝隨機學習金句；其他網址不變", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  await db.prepare("INSERT INTO short_links (slug, kind, value) VALUES ('us', 'series', '美國洛杉磯中心')").run();
  await db.prepare("DELETE FROM quotes").run();
  await db.prepare("INSERT INTO quotes (id, body, created_by) VALUES ('q1', '心若向陽，無畏悲傷 & \"成長\"', 'x')").run();
  const w = createWorker(files);
  const get = async (path: string) => (await w.fetch(new Request(`https://learn.test${path}`), env)).text();

  const page = await get("/us");
  assert.match(page, /<title>美國洛杉磯中心 \| 寰宇行動大學 🎓<\/title>/);
  assert.match(page, /property="og:title" content="美國洛杉磯中心 \| 寰宇行動大學 🎓"/);
  assert.match(page, /property="og:description" content="心若向陽，無畏悲傷 &amp; &quot;成長&quot;"/);
  assert.match(page, /property="og:image" content="https:\/\/learn\.test\/icon-512\.png"/);
  assert.match(page, /property="og:url" content="https:\/\/learn\.test\/us"/);
  // 不存在的縮寫、一般頁面：維持原本的網頁
  assert.equal(await get("/nope"), html);
  assert.equal(await get("/courses"), html);
  assert.equal(await get("/"), html);
  // 沒有任何金句時，說明退回網站名稱
  await db.prepare("DELETE FROM quotes").run();
  assert.match(await get("/us"), /property="og:description" content="寰宇行動大學"/);
  assert.equal(withShareMeta("<head></head>", { title: "a", description: "b", url: "u", image: "i" }).includes('content="b"'), true);
});

test("中心分享標題：只去掉數字代碼，不自動加「中心」（杜杜龍 2026-11-17）", async () => {
  assert.equal(centerShareName("南京中心 062"), "南京中心");
  assert.equal(centerShareName("美國洛杉磯中心"), "美國洛杉磯中心");
  assert.equal(centerShareName("嘉義生活美學館 166"), "嘉義生活美學館");
  assert.equal(centerShareName("安麗公司"), "安麗公司");
  assert.equal(centerShareName("南京 062"), "南京");
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  await db.prepare("INSERT INTO short_links (slug, kind, value) VALUES ('nj', 'center', '南京 062')").run();
  const page = await (await createWorker(files).fetch(new Request("https://learn.test/nj"), env)).text();
  assert.match(page, /property="og:title" content="南京 \| 寰宇行動大學 🎓"/);
});

test("分享預覽：沒設短網址的中心／分類／系列、已上架課程與章節都帶出標題；未上架不洩漏；特殊字元跳脫", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  await db.prepare("DELETE FROM quotes").run();
  await db.prepare("INSERT INTO center_names (center_key, center_label, display_name) VALUES (?, ?, ?)").bind("員林 153", "員林 153", "員林分校").run();
  await db.prepare("INSERT INTO courses (id, title, status) VALUES ('pub1', '公開課 <b>', 'published'), ('dr1', '草稿課', 'draft')").run();
  await db.prepare("INSERT INTO courses (id, title, status, host_unit, host_center_key) VALUES ('pub2', '員林的課', 'published', '員林 153', '員林 153')").run();
  await db.prepare("INSERT INTO lessons (id, course_id, position, title) VALUES ('l1', 'pub1', 1, '第一堂'), ('l2', 'dr1', 1, '草稿章節')").run();
  const w = createWorker(files);
  const get = async (path: string) => (await w.fetch(new Request(`https://learn.test${path}`), env)).text();
  const title = (page: string) => /property="og:title" content="([^"]*)"/.exec(page)?.[1];

  assert.equal(title(await get("/courses?center=%E5%BD%B0%E5%8C%96%20151")), "彰化 | 寰宇行動大學 🎓", "沒有短網址的中心（彰化 151）");
  assert.equal(title(await get("/courses?center=%E5%93%A1%E6%9E%97%20153")), "員林分校 | 寰宇行動大學 🎓", "有自訂名稱的中心");
  assert.equal(title(await get("/courses?category=%E6%96%B0%E4%BA%BA")), "新人 | 寰宇行動大學 🎓", "分類");
  assert.equal(title(await get("/courses?center=%E5%BD%B0%E5%8C%96%20151&category=%E6%96%B0%E4%BA%BA")), "彰化・新人 | 寰宇行動大學 🎓", "中心＋分類");
  assert.equal(title(await get("/series/%E7%BF%A1%E7%BF%A0%E9%81%94%E6%A8%99%E7%8F%AD")), "翡翠達標班 | 寰宇行動大學 🎓", "系列");
  assert.equal(title(await get("/course/pub1")), "公開課 &lt;b&gt; | 寰宇行動大學 🎓", "單堂課程＝課程名稱（杜杜龍 2026-11-26 一律格式）");
  assert.equal(title(await get("/course/pub2")), "員林的課 | 寰宇行動大學 🎓", "中心主辦的課程也是課程名稱");
  assert.equal(title(await get("/learn/pub1/l1")), "公開課 &lt;b&gt; | 寰宇行動大學 🎓", "章節也用課程名稱");
  assert.equal(await get("/course/dr1"), html, "未上架課程不洩漏名稱");
  assert.equal(await get("/learn/dr1/l2"), html, "未上架章節不洩漏");
  assert.equal(await get("/course/nope"), html);
  assert.equal(await get("/courses"), html, "沒有參數的 /courses 維持預設");
});

test("中心分享預覽：標題＝中心名稱 | 寰宇行動大學 🎓；中心卡第二行＝地址（沒填地址才用金句）；短網址與 /courses?center= 一致", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  await db.prepare("DELETE FROM quotes").run();
  await db.prepare("INSERT INTO quotes (id, body, created_by) VALUES ('q1', '每天進步一點點', 'x')").run();
  await db.prepare("INSERT INTO short_links (slug, kind, value) VALUES ('ch', 'center', '彰化 151')").run();
  const w = createWorker(files);
  const meta = async (path: string) => {
    const page = await (await w.fetch(new Request(`https://learn.test${path}`), env)).text();
    return { title: /property="og:title" content="([^"]*)"/.exec(page)?.[1], desc: /property="og:description" content="([^"]*)"/.exec(page)?.[1] };
  };
  const q = "/courses?center=%E5%BD%B0%E5%8C%96%20151";
  assert.deepEqual(await meta("/ch"), { title: "彰化 | 寰宇行動大學 🎓", desc: "每天進步一點點" }, "中心還沒填地址：退回金句");
  await db.prepare("INSERT INTO center_info (center_key, center_label, address) VALUES ('彰化 151', '彰化 151', '彰化市中山路 1 號')").run();
  const want = { title: "彰化 | 寰宇行動大學 🎓", desc: "📍 彰化市中山路 1 號" }; // 中心卡第二行固定是地址（杜杜龍 2026-11-26）
  assert.deepEqual(await meta("/ch"), want, "短網址");
  assert.deepEqual(await meta(q), want, "沒設短網址的網址");
  assert.deepEqual(await meta(`${q}&category=%E6%96%B0%E4%BA%BA`), { title: "彰化・新人 | 寰宇行動大學 🎓", desc: want.desc }, "中心＋分類");
  await db.prepare("DELETE FROM quotes").run();
  assert.equal((await meta("/ch")).desc, "📍 彰化市中山路 1 號", "有地址：不受金句影響，固定顯示地址");
});

test("分享預覽：縮寫照設定的大小寫顯示（og:url）、輸入不分大小寫；總部課程 /hq/…", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  await db.prepare("INSERT INTO short_links (slug, kind, value) VALUES ('NJ', 'center', '南京 062')").run();
  await db.prepare("INSERT INTO courses (id, title, status, host_center_key, url_name) VALUES ('a1', '中心課', 'published', '南京 062', 'wang-xiaoming-001'), ('h1', '總部課', 'published', NULL, 'wang-likai-001')").run();
  const w = createWorker(files);
  const meta = async (path: string) => {
    const page = await (await w.fetch(new Request(`https://learn.test${path}`), env)).text();
    return { title: /property="og:title" content="([^"]*)"/.exec(page)?.[1], url: /property="og:url" content="([^"]*)"/.exec(page)?.[1] };
  };
  assert.deepEqual(await meta("/nj"), { title: "南京 | 寰宇行動大學 🎓", url: "https://learn.test/NJ" }, "短網址：輸入小寫，顯示設定的大小寫");
  assert.deepEqual(await meta("/NJ/Wang-Xiaoming-001"), { title: "中心課 | 寰宇行動大學 🎓", url: "https://learn.test/NJ/wang-xiaoming-001" }, "中心課程網址");
  assert.deepEqual(await meta("/HQ/wang-likai-001"), { title: "總部課 | 寰宇行動大學 🎓", url: "https://learn.test/hq/wang-likai-001" }, "總部課程網址");
});

test("分享預設值：改標題格式、地址圖示、開關後，預覽卡片跟著變；單堂課程的卡片與主辦中心一致；分享文字範本帶入主講人與課程名稱", async () => {
  const { handleApi } = await import("../src/api.ts");
  const { shareMessage, DEFAULT_SHARE_SETTINGS } = await import("../src/contract.ts");
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as Record<string, any> };
  };
  const admin = (await call("POST", "/auth/demo", undefined, { sub: "demo-admin" })).data.token as string;
  const student = (await call("POST", "/auth/demo", undefined, { sub: "demo-student" })).data.token as string;
  await db.prepare("DELETE FROM quotes").run();
  await db.prepare("INSERT INTO quotes (id, body, created_by) VALUES ('q1', '每天進步一點點', 'x')").run();
  await db.prepare("INSERT INTO short_links (slug, kind, value) VALUES ('ch', 'center', '彰化 151')").run();
  await db.prepare("INSERT INTO center_info (center_key, center_label, address) VALUES ('彰化 151', '彰化 151', '彰化市中山路 1 號')").run();
  await db.prepare("INSERT INTO courses (id, title, status, host_unit, host_center_key) VALUES ('c1', '彰化的課', 'published', '彰化 151', '彰化 151')").run();
  const w = createWorker(files);
  const meta = async (path: string) => {
    const page = await (await w.fetch(new Request(`https://learn.test${path}`), env)).text();
    return { title: /property="og:title" content="([^"]*)"/.exec(page)?.[1], desc: /property="og:description" content="([^"]*)"/.exec(page)?.[1] };
  };
  const base = { title: "彰化 | 寰宇行動大學 🎓", desc: "📍 彰化市中山路 1 號" };
  assert.deepEqual(await meta("/ch"), base, "預設");
  assert.deepEqual(await meta("/course/c1"), { title: "彰化的課 | 寰宇行動大學 🎓", desc: "每天進步一點點" }, "單堂課程＝課程名稱");

  assert.equal((await call("PUT", "/admin/ui-config", student, { share: { siteName: "X" } })).status, 403, "只有超級管理員能改");
  const put = await call("PUT", "/admin/ui-config", admin, { share: { siteName: "寰宇大學", titleSeparator: "｜", addressIcon: "🏠", showQuote: false, courseText: "聽完 {課程名稱} by {主講人}" } });
  assert.equal(put.status, 200);
  assert.deepEqual(await meta("/ch"), { title: "彰化｜寰宇大學 🎓", desc: "🏠 彰化市中山路 1 號" }, "改了格式：中心卡第二行是地址");
  assert.deepEqual(await meta("/course/c1"), { title: "彰化的課｜寰宇大學 🎓", desc: "寰宇大學" });
  await call("PUT", "/admin/ui-config", admin, { share: { showAddress: false } });
  assert.equal((await meta("/ch")).desc, "寰宇大學", "地址與金句都關閉＝備用文字（站名）");
  await call("PUT", "/admin/ui-config", admin, { share: { siteName: "", titleSeparator: "   " } });
  assert.equal((await meta("/ch")).title, "彰化 | 寰宇行動大學 🎓", "站名、分隔符號清成空白＝退回預設，不會存成空的");

  const S = DEFAULT_SHARE_SETTINGS;
  assert.equal(shareMessage(S, "https://u/x"), "分享給我的好朋友，這裡有好多精彩的免費講座與課程唷 ❤️\n\n按此開啟網址 👉\nhttps://u/x");
  assert.equal(shareMessage(S, "https://u/y", { teacher: "王小明", title: "翡翠班" }), "我剛聽完這場 王小明的這場精彩演講 翡翠班 我就立刻想到要分享給你！\n\n按此開啟網址 👉\nhttps://u/y", "沒填職稱＝省略，不留空白");
  assert.equal(shareMessage(S, "https://u/y", { teacher: "王小明", teacherTitle: "區域經理", title: "翡翠班" }), "我剛聽完這場 王小明 區域經理的這場精彩演講 翡翠班 我就立刻想到要分享給你！\n\n按此開啟網址 👉\nhttps://u/y", "有職稱＝姓名後空一格接職稱");
  assert.equal(shareMessage(S, "u", { teacher: "王小明", teacherTitle: "   ", title: "T" }).includes("王小明的"), true, "職稱只有空白也當作沒填");
  assert.match(shareMessage(S, "u", { teacher: "", title: "T" }), /這場 老師的這場/, "沒有主講人用「老師」");
});

test("分享預設值：舊預設的單堂課程範本自動升級成含 {職稱} 的新預設；杜杜龍自己改過的不動", async () => {
  const { normalizeShare } = await import("../src/ui-config.ts");
  const { DEFAULT_SHARE_SETTINGS } = await import("../src/contract.ts");
  const old = "我剛聽完這場 {主講人}的這場精彩演講 {課程名稱} 我就立刻想到要分享給你！";
  assert.equal(normalizeShare({ courseText: old }).courseText, DEFAULT_SHARE_SETTINGS.courseText);
  assert.match(DEFAULT_SHARE_SETTINGS.courseText, /\{主講人\}\{職稱\}/);
  assert.equal(normalizeShare({ courseText: "聽完 {課程名稱} by {主講人}" }).courseText, "聽完 {課程名稱} by {主講人}");
  assert.equal(normalizeShare({}).courseText, DEFAULT_SHARE_SETTINGS.courseText);
});
