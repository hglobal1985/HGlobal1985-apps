#!/usr/bin/env node
// 至尊／超派兩種模式「功能自動同步」檢查（業主 2026-11-24：不要讓業主手動檢查、提醒）。
// 型別檢查（npm run typecheck）與部署腳本都會跑；違反就失敗，不能部署。
//
// 原則：兩種模式用「同一個元件、同一份權限判斷」，模式只決定「怎麼排版、哪些編輯小鈕要藏」，
// 而且這個決定一律寫在 lib/app-mode.tsx 的 MODE_PROFILES，由共用元件自己用 useFeature() 讀。
//
// 規則 1：features/elder/** 呼叫共用元件時，權限類的參數（can… / show… / allow… / editable / readOnly / hide…）
//         不可寫死 true / false，要用跟超派模式同一個判斷函式（例：canEditCenterArt）。
//         —— 2026-11-24 至尊模式 EDM 放大少了驚嘆號，就是 canEdit={false} 寫死造成的。
// 規則 2：除了白名單，畫面程式不可自己判斷「是不是至尊模式」（profile.key === "elder"、useElderOn()…），
//         一律用 useFeature("功能名") / useModeProfile() 的設定欄位 / <ModeGate>。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../src/", import.meta.url).pathname;
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(n)) files.push(p);
  }
};
walk(root);

// 規則 2 的白名單：模式本身的設定與切換。
const MODE_ALLOW = [/^lib\/app-mode\.tsx$/, /^lib\/elder-mode\.ts$/, /^lib\/global-scale\.ts$/, /^ui\/bottom-bar\.tsx$/, /^features\/elder\//];
const PERM_PROP = /\b((?:can|show|allow|hide)[A-Z]\w*|canEdit|editable|readOnly)=\{(true|false)\}/g;
const MODE_CHECK = /\bkey\s*[!=]==\s*"(elder|super)"|\buseElderOn\s*\(|\bgetElder\(\)\.on\b/g;

const errors = [];
for (const f of files) {
  const rel = relative(root, f).replaceAll("\\", "/");
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes("mode-parity-ok")) return; // 真的有必要時，在該行加註解「mode-parity-ok：原因」
    if (rel.startsWith("features/elder/")) {
      for (const m of line.matchAll(PERM_PROP)) errors.push(`${rel}:${i + 1}  至尊模式寫死權限參數 ${m[0]}——請改用跟超派模式同一個權限判斷`);
    }
    if (!MODE_ALLOW.some((r) => r.test(rel))) {
      for (const m of line.matchAll(MODE_CHECK)) errors.push(`${rel}:${i + 1}  畫面自己判斷模式 ${m[0]}——請改用 useFeature()／MODE_PROFILES 設定`);
    }
  });
}

if (errors.length) {
  console.error("✖ 至尊／超派模式同步檢查沒通過：\n  " + errors.join("\n  ") + "\n規則見 docs/rules/elder-mode.md「兩種模式功能自動同步」。");
  process.exit(1);
}
console.log(`✔ 至尊／超派模式同步檢查通過（${files.length} 個檔案）`);
