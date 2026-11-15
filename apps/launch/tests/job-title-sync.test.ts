import assert from "node:assert/strict";
import { test } from "node:test";
import { centralAddJobTitle, setCentralFetch } from "../src/central.ts";

test("新增職稱送中央：成功／中央尚未開放／暫時失敗；沒有憑證不送；永遠不丟例外", async () => {
  const calls: string[] = [];
  const fake = (status: number) => async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/v1/service/token")) return Response.json({ access_token: "t", expires_in: 300 });
    return new Response(JSON.stringify({ pool: "job_title", value: "區域經理", created: true }), { status, headers: { "content-type": "application/json" } });
  };
  setCentralFetch(fake(200));
  assert.equal(await centralAddJobTitle("secret", "區域經理"), "ok");
  assert.ok(calls.some((c) => c === "POST https://id.hglobal1985.com/v1/vocab/suggestions"));
  setCentralFetch(fake(404));
  assert.equal(await centralAddJobTitle("secret", "區域經理"), "unsupported");
  setCentralFetch(fake(503));
  assert.equal(await centralAddJobTitle("secret", "區域經理"), "retry");
  for (const st of [401, 429]) {
    setCentralFetch(fake(st));
    assert.equal(await centralAddJobTitle("secret", "區域經理"), "retry", `${st} 暫存重送`);
  }
  for (const st of [400, 403]) {
    setCentralFetch(fake(st));
    assert.equal(await centralAddJobTitle("secret", "區域經理"), "rejected", `${st} 不重送`);
  }
  assert.equal(await centralAddJobTitle(undefined, "區域經理"), "unsupported");
  setCentralFetch(async () => {
    throw new Error("network");
  });
  assert.equal(await centralAddJobTitle("secret", "區域經理"), "retry");
});
