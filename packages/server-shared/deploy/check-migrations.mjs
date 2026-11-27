// 資料庫 migration 編號檢查（杜杜龍 2026-11-27，自動檢查的一項）：每款 App 的 migrations 資料夾裡，
// 編號必須是 4 位數字、不能重複（兩個 AI 同時新增 migration 撞號時，合併前就擋下來，請把後加的改成下一個編號）。
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// 已經套用到正式資料庫的歷史撞號（改檔名會被當成新的 migration 再套用一次，所以不能改），列在這裡放行。
const HISTORICAL = new Set(["launch:0088"]);
const root = new URL("../../../", import.meta.url).pathname;
let bad = 0;
for (const app of readdirSync(join(root, "apps"))) {
  const dir = join(root, "apps", app, "migrations");
  if (!existsSync(dir)) continue;
  const seen = new Map();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const m = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(f);
    if (!m) {
      console.error(`⛔ apps/${app}/migrations/${f}：檔名要是「4 位數字_英文小寫底線.sql」`);
      bad++;
      continue;
    }
    if (seen.has(m[1]) && !HISTORICAL.has(`${app}:${m[1]}`)) {
      console.error(`⛔ apps/${app}/migrations：編號 ${m[1]} 重複（${seen.get(m[1])}、${f}）。請把後加的改成下一個沒用過的編號。`);
      bad++;
    }
    seen.set(m[1], f);
  }
  console.log(`✔ apps/${app}/migrations 檢查完成（最新編號 ${[...seen.keys()].pop() ?? "無"}）`);
}
process.exit(bad ? 1 : 0);
