// 部署安全檢查（共用：行動大學、繳作業系統與之後的每一款 App；杜杜龍 2026-11-20 起的規則，2026-11-27 抽成共用）。
// 多個 AI 對話、不同 Claude 帳號輪流或同時開發時，避免後部署的人蓋掉先部署的成果：
// 只有「乾淨的 main、而且已經包含線上版本」才准部署。線上版本由各 App 的版本網址回報 { sha }。
// GitHub 自動部署（DEPLOY_CI=1）時：main 在這段時間又有新的合併，就讓下一次自動部署處理，這次安靜略過。
import { execSync } from "node:child_process";

export const sh = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
export const run = (cmd) => execSync(cmd, { stdio: "inherit" });
export const die = (msg) => {
  console.error(`\n⛔ 不能部署：${msg}\n`);
  process.exit(1);
};

/** 檢查可以部署；回傳這次要部署的提交編號。versionUrl＝線上版本網址（回傳 JSON 有 sha）。 */
export async function deployGuard({ versionUrl, force = process.argv.includes("--force") }) {
  const ci = process.env.DEPLOY_CI === "1";
  // 部署到哪個 Cloudflare 帳號由環境變數決定（杜杜龍 2026-11-27 方案 B：公開程式庫不放帳號編號）。沒設定就不部署，避免部署到別的帳號。
  if (!/^[0-9a-f]{32}$/.test(process.env.CLOUDFLARE_ACCOUNT_ID ?? ""))
    die("沒有設定環境變數 CLOUDFLARE_ACCOUNT_ID（寰宇 Cloudflare 帳號編號）。請杜杜龍在這個雲端環境的設定加上它，再重新部署。");
  sh("git fetch origin main --quiet");
  const branch = sh("git rev-parse --abbrev-ref HEAD");
  const head = sh("git rev-parse HEAD");
  const origin = sh("git rev-parse origin/main");
  const dirty = sh("git status --porcelain");
  if (force) {
    console.warn("⚠️ 使用 --force：略過所有保護檢查，可能蓋掉別人的成果！");
    return head;
  }
  // GitHub 自動部署是全新取出的 main，只會有安裝套件產生的變動（例如 package-lock.json），不算「沒提交的修改」。
  if (dirty && !ci) die("有還沒提交的修改。請先提交並合併進 main。");
  if (head !== origin) {
    if (ci) {
      console.log("ℹ️ main 在這段時間又有新的合併，交給下一次自動部署，這次略過。");
      process.exit(0);
    }
    die(`目前不是最新的 main（分支：${branch}）。請先合併進 main 並 git pull，再部署。這樣才不會把別的 AI 已合併的成果蓋掉。`);
  }
  // 線上版本必須是目前程式的「祖先」：代表線上有的東西，這份程式都有。
  let live = null;
  try {
    const res = await fetch(versionUrl, { signal: AbortSignal.timeout(8000) });
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
    if (live === head && ci) {
      console.log(`ℹ️ 線上已經是 ${head.slice(0, 7)}，不用重複部署。`);
      process.exit(0);
    }
    console.log(`✅ 線上版本 ${live.slice(0, 7)} 已包含在目前程式內，可以部署。`);
  } else {
    console.log("ℹ️ 線上還沒有版本記錄（第一次使用這個流程），略過比對。");
  }
  return head;
}
