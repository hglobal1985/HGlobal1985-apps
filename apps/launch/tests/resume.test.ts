import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { CourseDetail } from "../src/contract.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("續播記憶：記住最後播放到的秒數，下次從那裡接著播；太靠近起點／結尾或已看完就從頭", async () => {
  const env: Env = { DB: createTestDb(), DEMO_LOGIN: "on" };
  const call = async <T = Record<string, unknown>,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await handleApi(new Request(`https://learn.test/api/v2${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as T };
  };
  const login = async (sub: string) => (await call<{ token: string }>("POST", "/auth/demo", undefined, { sub })).data.token;
  const [admin, student] = await Promise.all(["demo-admin", "demo-student"].map(login));
  const c = (await call<CourseDetail>("POST", "/admin/courses", admin, { title: "續播課", teacher: "王", status: "published", isPublic: true, priceTwd: 0 })).data;
  const l = c.lessons[0]!;
  await call("PATCH", `/admin/lessons/${l.id}`, admin, { mediaType: "youtube", mediaRef: "dQw4w9WgXcQ", startSeconds: 60, endSeconds: 600 });
  const pb = () => call<{ resumeAt?: number; start: number | null }>("GET", `/courses/${c.id}/lessons/${l.id}/playback`, student);
  assert.equal((await pb()).data.resumeAt, undefined, "第一次看：從起點");
  await call("POST", `/courses/${c.id}/lessons/${l.id}/watch`, student, { ratio: 0.2, position: 180.4 });
  assert.equal((await pb()).data.resumeAt, 180.4, "上次停在 180 秒");
  await call("POST", `/courses/${c.id}/lessons/${l.id}/watch`, student, { ratio: 0.1, position: 120 });
  assert.equal((await pb()).data.resumeAt, 120, "倒轉重看也照實記錄最後位置");
  await call("POST", `/courses/${c.id}/lessons/${l.id}/watch`, student, { ratio: 0.1, position: 62 });
  assert.equal((await pb()).data.resumeAt, undefined, "離起點不到 5 秒就從頭");
  await call("POST", `/courses/${c.id}/lessons/${l.id}/watch`, student, { ratio: 0.99, position: 595 });
  assert.equal((await pb()).data.resumeAt, undefined, "離結尾不到 10 秒就從頭");
  await call("POST", `/courses/${c.id}/lessons/${l.id}/watch`, student, { ratio: 0.5, position: 300 });
  assert.equal((await pb()).data.resumeAt, 300);
  await call("POST", `/courses/${c.id}/lessons/${l.id}/complete`, student);
  assert.equal((await pb()).data.resumeAt, undefined, "看完了：下次從頭");
  assert.equal((await call<{ resumeAt?: number }>("GET", `/courses/${c.id}/lessons/${l.id}/playback`, admin)).data.resumeAt, undefined, "每個人各自記錄");
});
