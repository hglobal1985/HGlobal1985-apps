import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPassword, checkPasswordInput, checkToken, expiresAt, hashPassword, libraryNumber, makeToken, pwActive } from "../src/library.ts";

test("書櫃密碼：雜湊驗證、幾天後失效、解鎖憑證到期與換密碼失效、網址編號格式", async () => {
  const h = await hashPassword("secret");
  assert.equal(await checkPassword("secret", h.hash, h.salt), true);
  assert.equal(await checkPassword("Secret", h.hash, h.salt), false);
  assert.equal(checkPasswordInput("abc", null).ok, false);
  assert.equal(checkPasswordInput("abcd", 0).ok, false);
  assert.deepEqual(checkPasswordInput("abcd", 7), { ok: true, password: "abcd", days: 7 });
  const now = Date.parse("2026-11-17T00:00:00Z");
  const exp = expiresAt(2, now)!;
  assert.equal(pwActive(exp, now + 86_400_000), true);
  assert.equal(pwActive(exp, now + 3 * 86_400_000), false, "過了失效日就不能用");
  assert.equal(pwActive(null, now + 9e12), true, "沒設失效日一直有效");
  const t = await makeToken(h.hash, "lib", exp, now);
  assert.equal(await checkToken(t.token, h.hash, "lib", now + 1000), true);
  assert.equal(await checkToken(t.token, h.hash, "other", now + 1000), false, "憑證只對同一個範圍有效");
  assert.equal(await checkToken(t.token, h.hash, "lib", now + 13 * 3600_000), false, "憑證最長 12 小時");
  assert.equal(t.until <= Date.parse(exp), true, "憑證不會超過密碼的失效時間");
  const other = await hashPassword("secret2");
  assert.equal(await checkToken(t.token, other.hash, "lib", now + 1000), false, "換密碼後舊憑證失效");
  assert.equal(libraryNumber(" TW9475831 "), "tw9475831");
  assert.equal(libraryNumber("a"), null);
  assert.equal(libraryNumber("中文"), null);
});
