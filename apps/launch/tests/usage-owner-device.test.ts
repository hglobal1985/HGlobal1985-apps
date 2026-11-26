import assert from "node:assert/strict";
import { test } from "node:test";
import { FP_RE, isOwnerDevice, ownerDevices, saveOwnerDevices } from "../src/usage.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("本人裝置登記：相同裝置特徵算本人，其他不算，可移除", async () => {
  const db = createTestDb();
  assert.ok(FP_RE.test("820x1180@2:ios:tablet"));
  assert.ok(!FP_RE.test("hello"));
  assert.equal(await isOwnerDevice(db, "820x1180@2:ios:tablet"), false);
  await saveOwnerDevices(db, [{ fp: "820x1180@2:ios:tablet", label: "iOS 平板・820x1180", at: new Date().toISOString() }]);
  assert.equal(await isOwnerDevice(db, "820x1180@2:ios:tablet"), true);
  assert.equal(await isOwnerDevice(db, "390x844@3:ios:mobile"), false); // 別種裝置不算
  assert.equal(await isOwnerDevice(db, undefined), false);
  assert.equal((await ownerDevices(db)).length, 1);
  await saveOwnerDevices(db, []);
  assert.equal(await isOwnerDevice(db, "820x1180@2:ios:tablet"), false);
});
