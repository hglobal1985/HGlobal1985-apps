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
  assert.match(page, /<title>美國洛杉磯中心 \| 寰宇行動大學<\/title>/);
  assert.match(page, /property="og:title" content="美國洛杉磯中心 \| 寰宇行動大學"/);
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

test("中心分享標題：去掉數字代碼，結尾是「中心」", async () => {
  assert.equal(centerShareName("南京 062"), "南京中心");
  assert.equal(centerShareName("美國洛杉磯"), "美國洛杉磯中心");
  assert.equal(centerShareName("飛登蓁分享 443"), "飛登蓁分享中心");
  assert.equal(centerShareName("台北中心"), "台北中心");
  assert.equal(centerShareName("高雄教育中心"), "高雄中心");
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  await db.prepare("INSERT INTO short_links (slug, kind, value) VALUES ('nj', 'center', '南京 062')").run();
  const page = await (await createWorker(files).fetch(new Request("https://learn.test/nj"), env)).text();
  assert.match(page, /property="og:title" content="南京中心 \| 寰宇行動大學"/);
});

test("分享預覽：沒設短網址的中心／分類／系列、已上架課程與章節都帶出標題；未上架不洩漏；特殊字元跳脫", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  await db.prepare("DELETE FROM quotes").run();
  await db.prepare("INSERT INTO center_names (center_key, center_label, display_name) VALUES (?, ?, ?)").bind("員林 153", "員林 153", "員林分校").run();
  await db.prepare("INSERT INTO courses (id, title, status) VALUES ('pub1', '公開課 <b>', 'published'), ('dr1', '草稿課', 'draft')").run();
  await db.prepare("INSERT INTO lessons (id, course_id, position, title) VALUES ('l1', 'pub1', 1, '第一堂'), ('l2', 'dr1', 1, '草稿章節')").run();
  const w = createWorker(files);
  const get = async (path: string) => (await w.fetch(new Request(`https://learn.test${path}`), env)).text();
  const title = (page: string) => /property="og:title" content="([^"]*)"/.exec(page)?.[1];

  assert.equal(title(await get("/courses?center=%E5%BD%B0%E5%8C%96%20151")), "彰化中心 | 寰宇行動大學", "沒有短網址的中心（彰化 151）");
  assert.equal(title(await get("/courses?center=%E5%93%A1%E6%9E%97%20153")), "員林分校 | 寰宇行動大學", "有自訂名稱的中心");
  assert.equal(title(await get("/courses?category=%E6%96%B0%E4%BA%BA")), "新人 | 寰宇行動大學", "分類");
  assert.equal(title(await get("/courses?center=%E5%BD%B0%E5%8C%96%20151&category=%E6%96%B0%E4%BA%BA")), "彰化中心・新人 | 寰宇行動大學", "中心＋分類");
  assert.equal(title(await get("/series/%E7%BF%A1%E7%BF%A0%E9%81%94%E6%A8%99%E7%8F%AD")), "翡翠達標班 | 寰宇行動大學", "系列");
  assert.equal(title(await get("/course/pub1")), "公開課 &lt;b&gt; | 寰宇行動大學", "已上架課程（特殊字元跳脫）");
  assert.equal(title(await get("/learn/pub1/l1")), "公開課 &lt;b&gt;｜第一堂 | 寰宇行動大學", "章節");
  assert.equal(await get("/course/dr1"), html, "未上架課程不洩漏名稱");
  assert.equal(await get("/learn/dr1/l2"), html, "未上架章節不洩漏");
  assert.equal(await get("/course/nope"), html);
  assert.equal(await get("/courses"), html, "沒有參數的 /courses 維持預設");
});

test("中心分享標題：有地址＝「彰化中心（地址） | 寰宇行動大學」，沒有地址就省略；短網址與 /courses?center= 一致", async () => {
  const db = createTestDb();
  const env: Env = { DB: db, DEMO_LOGIN: "on" };
  await db.prepare("INSERT INTO short_links (slug, kind, value) VALUES ('ch', 'center', '彰化 151')").run();
  const w = createWorker(files);
  const title = async (path: string) => /property="og:title" content="([^"]*)"/.exec(await (await w.fetch(new Request(`https://learn.test${path}`), env)).text())?.[1];
  assert.equal(await title("/ch"), "彰化中心 | 寰宇行動大學", "沒有地址");
  await db.prepare("INSERT INTO center_info (center_key, center_label, address) VALUES ('彰化 151', '彰化 151', '彰化市中山路 1 號')").run();
  assert.equal(await title("/ch"), "彰化中心（彰化市中山路 1 號） | 寰宇行動大學", "短網址");
  assert.equal(await title("/courses?center=%E5%BD%B0%E5%8C%96%20151"), "彰化中心（彰化市中山路 1 號） | 寰宇行動大學", "沒設短網址的網址");
  assert.equal(await title("/courses?center=%E5%BD%B0%E5%8C%96%20151&category=%E6%96%B0%E4%BA%BA"), "彰化中心（彰化市中山路 1 號）・新人 | 寰宇行動大學", "中心＋分類");
});
