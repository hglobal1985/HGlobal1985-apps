// 安全部署（杜杜龍 2026-11-20）：多個 AI 對話輪流或同時開發時，避免後部署的人蓋掉先部署的成果。
// 規則：只有「乾淨的 main、而且已經包含線上版本」才准部署；部署時把 git 提交編號寫進 Worker（GET /api/v2/version）。
// 用法：npm run deploy -w @learn/launch（先把自己的修改合併進 main 再執行）。緊急情況才用 --force（會警告）。
// 安全檢查本身是共用程式（packages/server-shared/deploy/guard.mjs，每款 App 同一份）。
import { deployGuard, die, run } from "../../../packages/server-shared/deploy/guard.mjs";

const head = await deployGuard({ versionUrl: "https://learn.hglobal1985.com/api/v2/version" });

// 套件齊全檢查（杜杜龍 2026-11-21：邀請按鈕壞掉，因為雲端環境沒裝到新加的 qrcode-generator，打包照樣成功、到使用者手機才當掉）。
// package.json 列的每個套件都要真的裝在 node_modules；缺了就先自動 npm install，還缺就停下來，不可以帶著缺的套件部署。
import { existsSync, readFileSync } from "node:fs";
const missingDeps = () => {
  const out = [];
  for (const pkg of ["../../mobile/package.json", "../package.json", "../../../package.json"]) {
    const url = new URL(pkg, import.meta.url);
    if (!existsSync(url)) continue;
    const j = JSON.parse(readFileSync(url, "utf8"));
    for (const name of Object.keys({ ...j.dependencies, ...j.devDependencies })) {
      if (name.startsWith("@learn/")) continue;
      const found = [`../../../node_modules/${name}/package.json`, `../../mobile/node_modules/${name}/package.json`, `../node_modules/${name}/package.json`].some((p) => existsSync(new URL(p, import.meta.url)));
      if (!found) out.push(name);
    }
  }
  return out;
};
if (missingDeps().length) {
  console.warn(`⚠️ 缺少套件：${missingDeps().join("、")}，自動執行 npm install…`);
  run("npm install");
  const still = missingDeps();
  if (still.length) die(`套件還是缺：${still.join("、")}。不可以帶著缺的套件部署，請檢查 package.json 與網路。`);
}

// 至尊／超派模式同步檢查（杜杜龍 2026-11-24）：至尊模式寫死權限、畫面自己判斷模式＝擋下不部署（apps/mobile/scripts/check-mode-parity.mjs）。
run(`node ${new URL("../../mobile/scripts/check-mode-parity.mjs", import.meta.url).pathname}`);
run("npm run build:web -w @learn/mobile");
run("npm run embed");
run("npx --yes wrangler@4 d1 migrations apply learn-v2 --remote");
run(`npx --yes wrangler@4 deploy --var GIT_SHA:${head}`);
console.log(`\n🚀 已部署版本 ${head.slice(0, 7)}`);
