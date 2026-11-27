// 截圖測試有差異或失敗時，開 GitHub Issue 通知杜杜龍（由 screenshot-test.yml 呼叫；沒有問題就什麼都不做）。
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const [reportPath, bodyPath] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const bad = report.results.filter((r) => r.status === "changed" || r.status === "failed");
if (bad.length === 0) {
  console.log("沒有差異，不開 Issue。");
  process.exit(0);
}
const lines = bad.map((r) => `- ${r.name}（${r.url}）：${r.status === "failed" ? `截圖失敗 ${r.error ?? ""}` : `畫面與上次相差 ${r.diff_percent}%`}`);
const body = [
  ...lines,
  "",
  "這是自動截圖測試（手機 390px）。差異若是預期的改版就不用處理、直接關閉；看起來不對請告訴 AI「繼續處理截圖測試的 Issue」。",
  `截圖與差異圖在這次執行的 Artifacts：${process.env.RUN_URL ?? ""}`,
].join("\n");
fs.writeFileSync(bodyPath, body);
const today = new Date().toISOString().slice(0, 10);
try {
  execFileSync("gh", ["label", "create", "screenshot-diff", "--color", "FBCA04", "--description", "截圖測試發現差異"], { stdio: "ignore" });
} catch {
  // 標籤已存在
}
execFileSync("gh", ["issue", "create", "--title", `截圖測試：主要畫面有變化（${today}）`, "--label", "screenshot-diff", "--body-file", bodyPath], { stdio: "inherit" });
