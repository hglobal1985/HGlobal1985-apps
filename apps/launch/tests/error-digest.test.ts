import assert from "node:assert/strict";
import { test } from "node:test";
import { createErrorDigest, digestKind, digestPage } from "../../../packages/server-shared/src/error-digest.ts";

test("錯誤統計：種類對應與頁面只留路徑", () => {
  assert.equal(digestKind("error"), "crash");
  assert.equal(digestKind("lazy-part"), "render");
  assert.equal(digestKind("chunk-load"), "network");
  assert.equal(digestKind("stuck"), "other");
  assert.equal(digestPage("/courses/12?token=abc#x"), "/courses/12");
  assert.equal(digestPage("https://evil/x"), "/");
  assert.equal(digestPage("/a b"), "/");
});

test("錯誤統計：同種類＋頁面累加，只送種類、路徑、版本、次數；失敗與 429 不重送", async () => {
  const calls: { url: string; body: any }[] = [];
  let status = 200;
  let t = 0;
  const d = createErrorDigest({
    central: "https://c.test", appId: "x", version: "1.2.3", now: () => t,
    getFetch: () => async (url, init) => { calls.push({ url, body: JSON.parse(String(init?.body)) }); return new Response("{}", { status, headers: { "retry-after": "60" } }); },
  });
  d.record("render", "/a?secret=1");
  d.record("render", "/a");
  d.record("error", "/b");
  assert.equal(await d.flush(), 2);
  assert.equal(calls[0]!.url, "https://c.test/v1/apps/x/error-reports");
  assert.deepEqual(calls[0]!.body, { reports: [{ kind: "render", page: "/a", app_version: "1.2.3", count: 2 }, { kind: "crash", page: "/b", app_version: "1.2.3", count: 1 }] });
  assert.equal(await d.flush(), 0); // 沒有東西可送
  status = 429; t = 1000;
  d.record("api", "/c");
  assert.equal(await d.flush(), 0);
  status = 200; d.record("api", "/c");
  assert.equal(await d.flush(), 0); // 429 後等待期間不送
  t = 100_000;
  assert.equal(await d.flush(), 1);
});
