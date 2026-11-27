// 寰宇繳作業系統的安全部署（杜杜龍 2026-11-27：與行動大學同一套保護，共用 packages/server-shared/deploy/guard.mjs）。
// 只有「乾淨的 main、而且已經包含線上版本」才准部署；部署時把 git 提交編號寫進 Worker（GET /api/version 的 sha）。
// 用法：npm run deploy -w @check/api（先把自己的修改合併進 main 再執行）。
import { deployGuard, run } from "../../../packages/server-shared/deploy/guard.mjs";

const head = await deployGuard({ versionUrl: "https://check.hglobal1985.com/api/version" });
const here = new URL("..", import.meta.url).pathname;
run(`cd ${here}../check-app && npx expo export --platform web`);
run(`cd ${here} && node scripts/embed-static.mjs`);
run(`cd ${here} && npx --yes wrangler@4 d1 migrations apply check --remote`);
run(`cd ${here} && npx --yes wrangler@4 deploy --var GIT_SHA:${head}`);
console.log(`\n🚀 已部署寰宇繳作業系統版本 ${head.slice(0, 7)}`);
