import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig, saveConfig, setSharedKv } from "../src/ui-config.ts";
import { resetSharedUploadMemo } from "../../../packages/server-shared/src/upload-settings.ts";
import { createTestDb } from "./sqlite-d1.ts";

test("上傳壓縮設定與繳作業系統共用：第一次自動放進共用儲存區、存檔同步、讀取以共用為準", async () => {
  resetSharedUploadMemo();
  const store = new Map<string, string>();
  setSharedKv({ get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v) });
  const db = createTestDb();
  const cfg = await loadConfig(db);
  assert.equal(JSON.parse(store.get("upload")!).imageMaxSide, cfg.app.imageMaxSide, "第一次讀取時把目前設定放進共用儲存區");
  await saveConfig(db, { ...cfg, app: { ...cfg.app, imageMaxSide: 1500, videoKbps: 1800 } });
  assert.equal(JSON.parse(store.get("upload")!).imageMaxSide, 1500, "存檔同步寫進共用儲存區");
  // 繳作業系統改了共用設定 → 行動大學讀到新的值
  store.set("upload", JSON.stringify({ ...JSON.parse(store.get("upload")!), imageQuality: 70 }));
  resetSharedUploadMemo();
  assert.equal((await loadConfig(db)).app.imageQuality, 70);
  setSharedKv(undefined);
  resetSharedUploadMemo();
});
