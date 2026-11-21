// 安全部署（業主 2026-11-20）：多個 AI 對話輪流或同時開發時，避免後部署的人蓋掉先部署的成果。
// 規則：只有「乾淨的 main、而且已經包含線上版本」才准部署；部署時把 git 提交編號寫進 Worker（GET /api/v2/version）。
// 用法：npm run deploy -w @learn/launch（先把自己的修改合併進 main 再執行）。緊急情況才用 --force（會警告）。
import { execSync } from "node:child_process";

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const force = process.argv.includes("--force");
const SITE = "https://learn.hglobal1985.com";
const die = (msg) => {
  console.error(`\n⛔ 不能部署：${msg}\n`);
  process.exit(1);
};

sh("git fetch origin main --quiet");
const branch = sh("git rev-parse --abbrev-ref HEAD");
const head = sh("git rev-parse HEAD");
const origin = sh("git rev-parse origin/main");
const dirty = sh("git status --porcelain");

if (!force) {
  if (dirty) die("有還沒提交的修改。請先提交並合併進 main。");
  if (head !== origin) die(`目前不是最新的 main（分支：${branch}）。請先合併進 main 並 git pull，再部署。這樣才不會把別的 AI 已合併的成果蓋掉。`);
  // 線上版本必須是目前程式的「祖先」：代表線上有的東西，這份程式都有。
  let live = null;
  try {
    const res = await fetch(`${SITE}/api/v2/version`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) live = (await res.json()).sha ?? null;
  } catch {
    console.warn("⚠️ 讀不到線上版本（網路問題），改用提交紀錄檢查。");
  }
  if (live) {
    try {
      sh(`git cat-file -e ${live}^{commit}`);
    } catch {
      sh("git fetch origin --quiet");
    }
    try {
      sh(`git merge-base --is-ancestor ${live} ${head}`);
    } catch {
      die(`線上版本（${live.slice(0, 7)}）不在這份程式的歷史裡，直接部署會蓋掉別人的成果。請先 git pull origin main 取得最新程式再試。`);
    }
    console.log(`✅ 線上版本 ${live.slice(0, 7)} 已包含在目前程式內，可以部署。`);
  } else {
    console.log("ℹ️ 線上還沒有版本記錄（第一次使用這個流程），略過比對。");
  }
} else {
  console.warn("⚠️ 使用 --force：略過所有保護檢查，可能蓋掉別人的成果！");
}

// 套件齊全檢查（業主 2026-11-21：邀請按鈕壞掉，因為雲端環境沒裝到新加的 qrcode-generator，打包照樣成功、到使用者手機才當掉）。
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

run("npm run build:web -w @learn/mobile");
run("npm run embed");
run("npx --yes wrangler@4 d1 migrations apply learn-v2 --remote");
run(`npx --yes wrangler@4 deploy --var GIT_SHA:${head}`);
console.log(`\n🚀 已部署版本 ${head.slice(0, 7)}`);
