import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../src/api.ts";
import type { Env } from "../src/d1.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("前台錯誤回報：不用登入、只寫錯誤紀錄、同一來源每分鐘最多 10 則", async () => {
  const env: Env = { DB: createTestDb() };
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
  try {
    for (let i = 0; i < 12; i++) {
      const res = await handleApi(new Request("https://learn.test/api/v2/client-errors", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" }, body: JSON.stringify({ kind: "render", message: "TypeError: x is undefined", page: "/courses" }) }), env);
      assert.equal(res.status, 200);
    }
  } finally {
    console.error = orig;
  }
  const hits = logged.filter((l) => l.startsWith("client error"));
  assert.equal(hits.length, 10);
  assert.match(hits[0]!, /x is undefined/);
});
