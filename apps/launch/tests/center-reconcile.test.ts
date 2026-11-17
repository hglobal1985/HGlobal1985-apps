import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileCenters } from "../src/center-reconcile.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("中央改名（新竹 122→新竹中心 122、美國洛杉磯→美國洛杉磯中心）：課程、訂閱、封面等資料自動跟著換鑰匙", async () => {
  const db = createTestDb();
  await db.prepare("INSERT INTO courses (id, title, host_unit, host_center_key, status) VALUES ('c1','A','新竹 122、自強 061','新竹 122','published'), ('c2','B','美國洛杉磯','美國洛杉磯','published'), ('c3','C','台南 187','台南 187','published')").run();
  await db.prepare("INSERT INTO center_subscriptions (member_sub, center_key) VALUES ('m1','新竹 122'), ('m1','新竹中心 122')").run();
  await db.prepare("INSERT INTO center_info (center_key, center_label, address) VALUES ('新竹 122','新竹 122','某地址')").run();
  const labels = ["新竹中心 122", "自強中心 061", "美國洛杉磯中心", "台南創客中心 187"];
  assert.equal(await reconcileCenters(db, labels), 4); // 新竹、自強、美國洛杉磯、台南
  const get = async (id: string) => ({ ...(await db.prepare("SELECT host_center_key AS k, host_unit AS u FROM courses WHERE id = ?").bind(id).first<{ k: string; u: string }>())! });
  assert.deepEqual(await get("c1"), { k: "新竹中心 122", u: "新竹中心 122、自強中心 061" });
  assert.deepEqual(await get("c2"), { k: "美國洛杉磯中心", u: "美國洛杉磯中心" });
  assert.deepEqual(await get("c3"), { k: "台南創客中心 187", u: "台南創客中心 187" });
  const subs = await db.prepare("SELECT center_key FROM center_subscriptions").all<{ center_key: string }>();
  assert.deepEqual(subs.results.map((r) => r.center_key), ["新竹中心 122"], "新舊鑰匙重複的訂閱只留一筆");
  assert.equal((await db.prepare("SELECT center_label AS l FROM center_info WHERE center_key = '新竹中心 122'").first<{ l: string }>())?.l, "新竹中心 122");
  assert.equal(await reconcileCenters(db, labels), 0, "再跑一次不會再動");
});
