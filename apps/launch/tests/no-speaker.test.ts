import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import { romanizeTitle } from "../src/romanize.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("勾「無」：主講人、獎銜、職稱清空，專屬網址用課程名稱英譯＋編號；取消勾選回到主講人英譯", async () => {
  const db = createTestDb();
  const env = { DB: db, DEMO_LOGIN: "on" } as never;
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as Record<string, unknown> };
  };
  const token = (await (await handleApi(new Request("https://learn.test/api/v2/auth/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sub: "demo-admin" }) }), env)).json() as { token: string }).token;
  const urlOf = async (id: string) => (await db.prepare("SELECT url_name, teacher, teacher_rank, teacher_title, no_speaker FROM courses WHERE id = ?").bind(id).first<Record<string, unknown>>())!;

  assert.equal(romanizeTitle("脂肪對身體的影響").startsWith("zhi-"), true);
  assert.ok(romanizeTitle("非常非常非常非常非常非常非常非常非常長的課程名稱用來測試網址長度限制是否有效").length <= 40);

  const a = await call("POST", "/admin/courses", token, { title: "脂肪對身體的影響", noSpeaker: true, teacher: "王大明", teacherTitle: "講師", teacherRank: "gold" });
  assert.equal(a.status, 200);
  const rowA = await urlOf(a.data.id as string);
  assert.deepEqual([rowA.teacher, rowA.teacher_rank, rowA.teacher_title, rowA.no_speaker], ["", "", "", 1]);
  assert.equal(rowA.url_name, `${romanizeTitle("脂肪對身體的影響")}-1`);
  assert.equal(a.data.noSpeaker, true);

  // 同名第二門課：編號 +1
  const b = await call("POST", "/admin/courses", token, { title: "脂肪對身體的影響", noSpeaker: true });
  assert.equal((await urlOf(b.data.id as string)).url_name, `${romanizeTitle("脂肪對身體的影響")}-2`);

  // 取消勾選並填主講人：網址改用主講人英譯（舊網址仍有效，存進別名）
  const c = await call("PATCH", `/admin/courses/${a.data.id}`, token, { noSpeaker: false, teacher: "王大明" });
  assert.equal(c.status, 200);
  assert.equal((await urlOf(a.data.id as string)).url_name, "wang-daming-1");
  const alias = await db.prepare("SELECT url_name FROM course_url_aliases WHERE course_id = ?").bind(a.data.id as string).first<{ url_name: string }>();
  assert.equal(alias?.url_name, `${romanizeTitle("脂肪對身體的影響")}-1`);
});
