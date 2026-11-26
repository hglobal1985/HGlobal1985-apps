import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { resolveShareMeta } from "../src/og.ts";
import { photoOcrIds } from "../src/photo-ocr.ts";
import { sceneIds } from "../src/scene-vision.ts";
import { youtubeIdOfLine, videoCount } from "../src/recipes.ts";
import { createTestDb } from "./sqlite-d1.ts";

// 杜杜龍 2026-11-26：食譜專區（一道食譜＝多張照片＋一篇文字＋影片連結；會員投稿要審核）。
test("YouTube 網址：只有獨立一行才算影片", () => {
  assert.equal(youtubeIdOfLine("https://youtu.be/AbC123xyz"), "AbC123xyz");
  assert.equal(youtubeIdOfLine("  https://www.youtube.com/watch?v=AbC123xyz&t=3  "), "AbC123xyz");
  assert.equal(youtubeIdOfLine("https://www.youtube.com/shorts/AbC123xyz"), "AbC123xyz");
  assert.equal(youtubeIdOfLine("看這支 https://youtu.be/AbC123xyz"), null, "文字中間的網址不算");
  assert.equal(youtubeIdOfLine("https://example.com/watch?v=AbC123xyz"), null);
  assert.equal(videoCount("材料\nhttps://youtu.be/AbC123xyz\n做法\nhttps://youtu.be/ZzZ987abc"), 2);
});

test("食譜：草稿 → 會員投稿待審核 → 管理者核准；權限與照片", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
    const text = await res.text();
    return { status: res.status, data: (text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", { body: { sub } })).data.token;
  const [admin, a, b] = await Promise.all([login("demo-admin"), login("demo-student"), login("demo-silver")]);
  type List = { categories: { id: string; name: string; count: number }[]; recipes: { id: string; status: string; title: string; canEdit: boolean; videos: number }[]; manager: boolean; canSubmit: boolean };

  const l0 = (await call<List>("GET", "/recipes")).data;
  assert.deepEqual(l0.categories.map((c) => c.name), ["西式", "中式", "湯品", "點心", "飲品"], "預設五個分類");
  assert.equal(l0.canSubmit, false, "訪客不能投稿");
  assert.equal((await call("POST", "/recipes")).status, 401);

  // 會員投稿
  const id = (await call<{ id: string }>("POST", "/recipes", { token: a })).data.id;
  assert.equal((await call<List>("GET", "/recipes", { token: a })).data.recipes.length, 0, "草稿不在列表");
  assert.equal((await call("PUT", `/recipes/${id}`, { token: a, body: { title: "", finish: true } })).status, 400, "名稱必填");
  assert.equal((await call("PUT", `/recipes/${id}`, { token: b, body: { title: "x" } })).status, 403, "別人不能改我的草稿");
  const saved = await call<{ status: string; body: string }>("PUT", `/recipes/${id}`, { token: a, body: { title: "瑪格麗特披薩", categoryId: "western", body: "材料：\r\n牛番茄\r\nhttps://youtu.be/AbC123xyz\r\n", finish: true } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.status, "pending", "會員投稿進待審核");
  assert.equal(saved.data.body, "材料：\n牛番茄\nhttps://youtu.be/AbC123xyz");
  type Notices = { notifications?: { title: string; link: string }[] } | { title: string; link: string }[];
  const notices = async (token: string) => {
    const r = (await call<Notices>("GET", "/notifications", { token })).data;
    return Array.isArray(r) ? r : (r.notifications ?? []);
  };
  assert.ok((await notices(admin)).some((n) => n.title === "有新的食譜投稿，等待審核" && n.link === `/recipe/${id}`), "會員投稿：通知管理者");
  assert.equal((await call<List>("GET", "/recipes", { token: b })).data.recipes.length, 0, "別的會員看不到待審核");
  const mine = (await call<List>("GET", "/recipes", { token: a })).data.recipes;
  assert.deepEqual(mine.map((r) => [r.status, r.canEdit, r.videos]), [["pending", true, 1]], "投稿者看得到自己的，可修改");
  const adm = (await call<List>("GET", "/recipes", { token: admin })).data;
  assert.equal(adm.manager, true);
  assert.equal(adm.recipes.length, 1, "管理者看得到待審核");

  // 審核
  assert.equal((await call("POST", `/recipes/${id}/approve`, { token: a })).status, 403, "會員不能自己核准");
  assert.equal((await call("POST", `/recipes/${id}/approve`, { token: admin })).status, 200);
  assert.equal((await call<List>("GET", "/recipes", { token: b })).data.recipes[0]?.title, "瑪格麗特披薩", "核准後所有人看得到");
  assert.ok((await notices(a)).some((n) => n.title === "你投稿的食譜已通過審核"), "核准後通知投稿者");
  // 加入我的清單：食譜也能加入，已發佈才算有效
  type MyList = { id: string; items?: { kind: string; ref: string; title: string; missing: boolean }[] };
  const made = await call<{ id: string }>("POST", "/my-lists", { token: b, body: { title: "晚餐", kind: "recipe", ref: id } });
  assert.equal(made.status, 200, "清單可放食譜");
  const mine2 = (await call<MyList>("GET", `/my-lists/${made.data.id}`, { token: b })).data;
  assert.deepEqual(mine2.items?.map((i) => [i.kind, i.title, i.missing]), [["recipe", "瑪格麗特披薩", false]]);
  assert.equal((await call("PUT", `/recipes/${id}`, { token: a, body: { title: "改名" } })).status, 403, "核准後投稿者不能再改");
  assert.equal((await call("GET", `/recipes?q=${encodeURIComponent("牛番茄")}`)).status, 200);
  assert.equal(((await call<List>("GET", `/recipes?q=${encodeURIComponent("牛番茄")}`)).data).recipes.length, 1, "文字內容也能搜尋");
  assert.equal(((await call<List>("GET", `/recipes?q=${encodeURIComponent("burger")}`)).data).recipes.length, 0);

  // 短網址 /icook/001：送出時領流水號；前綴可在設定改，舊前綴照樣有效；LINE 預覽卡
  type Detail = { number: number | null; shortPath: string | null };
  const d1 = (await call<Detail>("GET", `/recipes/${id}`)).data;
  assert.deepEqual([d1.number, d1.shortPath], [1, "/icook/001"], "第一道食譜＝001");
  assert.equal((await call<{ recipeId?: string }>("GET", "/short-links/icook/001")).data.recipeId, id);
  assert.equal((await call<{ recipeId?: string }>("GET", "/short-links/ICOOK/001")).data.recipeId, id, "不分大小寫");
  assert.equal((await call("GET", "/short-links/icook/002")).status, 404);
  const meta = await resolveShareMeta(env.DB, new URL("https://learn.test/icook/001"));
  assert.ok(meta?.title.startsWith("瑪格麗特披薩"), "預覽卡標題＝食譜名稱＋站名");
  assert.ok(meta?.title.includes("寰宇行動大學"));
  assert.ok(meta?.image.endsWith("/icon-512.png"), "還沒有照片：用網站圖示");
  assert.equal((await call("GET", `/recipes/${id}/cover`)).status, 404, "沒有照片：封面縮圖 404");
  assert.equal((await resolveShareMeta(env.DB, new URL("https://learn.test/recipe/" + id)))?.title, meta?.title, "/recipe/編號 同一張卡");
  assert.equal(await resolveShareMeta(env.DB, new URL("https://learn.test/icook/009")), null);
  assert.equal((await call("PUT", "/admin/ui-config", { token: a, body: { share: { recipePrefix: "cook" } } })).status, 403, "只有超級管理員能改前綴");
  assert.equal((await call("PUT", "/admin/ui-config", { token: admin, body: { share: { recipePrefix: "courses" } } })).status, 400, "不能用網站保留路徑");
  assert.equal((await call("PUT", "/admin/ui-config", { token: admin, body: { share: { recipePrefix: "cook" } } })).status, 200);
  assert.equal((await call<{ recipeId?: string }>("GET", "/short-links/cook/001")).data.recipeId, id, "新前綴");
  assert.equal((await call<{ recipeId?: string }>("GET", "/short-links/icook/001")).data.recipeId, id, "舊前綴照樣打得開");
  assert.equal((await call<Detail>("GET", `/recipes/${id}`)).data.shortPath, "/cook/001");
  assert.equal((await call("PUT", "/admin/short-links", { token: admin, body: { kind: "series", value: "X", slug: "cook" } })).status, 409, "別的短網址不能佔用食譜前綴");

  // 上傳者：暱稱與所屬中心；超級管理員可更換（從已註冊會員用暱稱搜尋）
  assert.equal((await call<{ authorName: string; admin: boolean }>("GET", `/recipes/${id}`, { token: admin })).data.admin, true);
  assert.equal((await call<{ admin: boolean }>("GET", `/recipes/${id}`, { token: a })).data.admin, false);
  await env.DB.prepare("INSERT OR REPLACE INTO member_profiles (sub, name, avatar) VALUES ('demo-silver', '銀章小明', '')").run();
  assert.equal((await call("GET", "/admin/recipe-authors?q=" + encodeURIComponent("小明"), { token: a })).status, 403, "只有超級管理員能搜尋");
  const found = (await call<{ members: { sub: string; name: string }[] }>("GET", "/admin/recipe-authors?q=" + encodeURIComponent("小明"), { token: admin })).data.members;
  assert.deepEqual(found.map((m) => [m.sub, m.name]), [["demo-silver", "銀章小明"]], "暱稱可搜尋");
  assert.equal((await call("PUT", `/admin/recipes/${id}/author`, { token: a, body: { sub: "demo-silver" } })).status, 403);
  assert.equal((await call("PUT", `/admin/recipes/${id}/author`, { token: admin, body: { sub: "nobody" } })).status, 404, "只能換成已註冊的會員");
  const changed = await call<{ authorName: string }>("PUT", `/admin/recipes/${id}/author`, { token: admin, body: { sub: "demo-silver" } });
  assert.equal(changed.data.authorName, "銀章小明");
  assert.equal((await call<List>("GET", "/recipes", { token: admin })).data.recipes.find((r) => r.id === id) !== undefined, true);

  // 管理者新增、直接發佈
  const id2 = (await call<{ id: string }>("POST", "/recipes", { token: admin })).data.id;
  assert.equal((await call<{ status: string }>("PUT", `/recipes/${id2}`, { token: admin, body: { title: "南瓜濃湯", categoryId: "soup", finish: true } })).data.status, "published", "管理者直接發佈");

  // 分類：有權限的人新增與改名；只有超級管理員刪除
  assert.equal((await call("POST", "/recipes/categories", { token: a, body: { name: "早餐" } })).status, 403);
  const cat = (await call<{ id: string }>("POST", "/recipes/categories", { token: admin, body: { name: "早餐" } })).data.id;
  assert.equal((await call("POST", "/recipes/categories", { token: admin, body: { name: "早餐" } })).status, 409, "不能重名");
  assert.equal((await call("PUT", `/recipes/categories/${cat}`, { token: admin, body: { name: "早午餐" } })).status, 200);
  assert.ok((await call<List>("GET", "/recipes")).data.categories.some((c) => c.name === "早午餐"));

  // 照片用相簿的上傳（key＝rcp:編號）：沒權限擋下
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 50 }, (_, i) => i)]);
  const up = (token: string, rid: string) => handleApi(new Request(`https://learn.test/api/v2/admin/cover-media?kind=course&key=${encodeURIComponent(`rcp:${rid}`)}&w=100&h=100`, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: jpeg }), { ...env, MEDIA: undefined });
  assert.equal((await up(b, id)).status, 403, "別人不能替我的食譜上傳照片");

  // 刪除
  assert.equal((await call("DELETE", `/recipes/${id}`, { token: a })).status, 403, "核准後投稿者不能刪");
  assert.equal((await call("DELETE", `/recipes/${id}`, { token: admin })).status, 200);
  assert.equal((await call("GET", `/recipes/${id}`)).status, 404);
  assert.equal((await call("DELETE", `/recipes/categories/${cat}`, { token: a })).status, 403);
});

test("食譜照片：做場景辨識、不做文字辨識；食譜搜尋也比對場景標籤", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const db = env.DB;
  await db.prepare("INSERT INTO recipes (id, title, status, author_sub, number) VALUES ('r1abc2def3', '烤雞', 'published', 'x', 1)").run();
  await db.prepare("INSERT INTO cover_media (id, owner_kind, owner_key, kind, r2_key, ocr_status, scene_status) VALUES ('m1', 'course', 'rcp:r1abc2def3', 'image', 'album/a/b.jpg', 'skip', '')").run();
  assert.deepEqual(await sceneIds(db, 10), ["m1"], "食譜照片排進場景辨識");
  assert.deepEqual(await photoOcrIds(db, 10), [], "食譜照片不排進文字辨識");
  await db.prepare("UPDATE cover_media SET scene_text = '烤箱,雞肉,餐盤', scene_status = 'done' WHERE id = 'm1'").run();
  const res = await handleApi(new Request(`https://learn.test/api/v2/recipes?q=${encodeURIComponent("雞肉")}`), env);
  assert.equal(((await res.json()) as { recipes: unknown[] }).recipes.length, 1, "用場景標籤找得到食譜");
});
