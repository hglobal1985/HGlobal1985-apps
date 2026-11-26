import assert from "node:assert/strict";
import { test } from "node:test";
import { FP_RE, isOwnerDevice, ownerDevices, registerOwnerDevice, saveOwnerDevices } from "../src/usage.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("本人裝置登記：裝置特徵＋登記過的網路兩個都符合才算本人", async () => {
  const db = createTestDb();
  const FP = "820x1180@2:ios:tablet";
  assert.ok(FP_RE.test(FP));
  assert.ok(!FP_RE.test("hello"));
  assert.equal(await isOwnerDevice(db, FP, "1.2.3.4"), false);
  await registerOwnerDevice(db, FP, "iOS 平板", "1.2.3.4");
  assert.equal(await isOwnerDevice(db, FP, "1.2.3.4"), true);
  assert.equal(await isOwnerDevice(db, FP, "9.9.9.9"), false, "同裝置特徵但不是登記過的網路：不算（可能是別人的同型號裝置）");
  assert.equal(await isOwnerDevice(db, "390x844@3:ios:mobile", "1.2.3.4"), false, "同網路但不同裝置特徵：不算");
  assert.equal(await isOwnerDevice(db, undefined, "1.2.3.4"), false);
  await registerOwnerDevice(db, FP, "", "5.6.7.8"); // 換到另一個網路再登記
  assert.equal(await isOwnerDevice(db, FP, "5.6.7.8"), true);
  assert.equal(await isOwnerDevice(db, FP, "1.2.3.4"), true, "原本的網路仍然有效");
  assert.equal((await ownerDevices(db)).length, 1);
  assert.equal((await ownerDevices(db))[0]!.nets.length, 2);
  await saveOwnerDevices(db, []);
  assert.equal(await isOwnerDevice(db, FP, "1.2.3.4"), false);
});
