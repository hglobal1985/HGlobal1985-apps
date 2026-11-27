// 主要畫面自動截圖測試（生態系統功能 screenshot_test，杜杜龍 2026-11-27）。
// 用 Playwright 以手機寬度截清單裡的公開頁面，和上次的截圖比對；有差異就寫出 report.json。
// 只截不用登入的公開頁面（Actions 的截圖檔在公開程式庫是公開的，不可截含會員資料的畫面）。
// 用法：node scripts/screenshot-test.mjs <清單.json> <輸出資料夾> <上次截圖資料夾>
// 需要先安裝 playwright、pngjs、pixelmatch（workflow 會裝）。不耗 AI 額度。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// 工具裝在專案外（環境變數 SHOT_TOOLS 指到裝了 playwright、pngjs、pixelmatch 的資料夾），不改專案的套件清單。
const req = createRequire(path.join(process.env.SHOT_TOOLS ?? process.cwd(), "noop.js"));
const { chromium } = req("playwright");
const { PNG } = req("pngjs");
const pixelmatchMod = await import(req.resolve("pixelmatch"));
const pixelmatch = pixelmatchMod.default ?? pixelmatchMod;

const [listPath, outDir, prevDir] = process.argv.slice(2);
if (!listPath || !outDir || !prevDir) {
  console.error("用法：node scripts/screenshot-test.mjs <清單.json> <輸出資料夾> <上次截圖資料夾>");
  process.exit(2);
}
const cfg = JSON.parse(fs.readFileSync(listPath, "utf8"));
const viewport = cfg.viewport ?? { width: 390, height: 844 };
const threshold = Number(cfg.threshold_percent ?? 2);
fs.mkdirSync(outDir, { recursive: true });

const results = [];
const browser = await chromium.launch();
try {
  for (const p of cfg.pages) {
    const r = { name: p.name, url: p.url, status: "ok", diff_percent: 0 };
    try {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "zh-TW", timezoneId: "Asia/Taipei" });
      const page = await ctx.newPage();
      const res = await page.goto(p.url, { waitUntil: "networkidle", timeout: 45000 });
      if (!res || res.status() >= 400) throw new Error(`HTTP ${res ? res.status() : "無回應"}`);
      if (p.wait_for) await page.waitForSelector(p.wait_for, { timeout: 15000 });
      await page.waitForTimeout(1500);
      const file = path.join(outDir, `${p.name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      await ctx.close();
      // 會輪播或每天不同的區塊（ignore: [{x,y,width,height}]）塗成灰色，不拿來比對
      if (Array.isArray(p.ignore) && p.ignore.length) {
        const img = PNG.sync.read(fs.readFileSync(file));
        for (const g of p.ignore) {
          for (let y = Math.max(0, g.y); y < Math.min(img.height, g.y + g.height); y++) {
            for (let x = Math.max(0, g.x); x < Math.min(img.width, g.x + g.width); x++) {
              const i = (y * img.width + x) * 4;
              img.data[i] = img.data[i + 1] = img.data[i + 2] = 128;
              img.data[i + 3] = 255;
            }
          }
        }
        fs.writeFileSync(file, PNG.sync.write(img));
      }
      const prev = path.join(prevDir, `${p.name}.png`);
      if (!fs.existsSync(prev)) {
        r.status = "new";
      } else {
        const a = PNG.sync.read(fs.readFileSync(prev));
        const b = PNG.sync.read(fs.readFileSync(file));
        if (a.width !== b.width || a.height !== b.height) {
          r.status = "changed";
          r.diff_percent = 100;
        } else {
          const diff = new PNG({ width: a.width, height: a.height });
          const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
          r.diff_percent = Math.round((n / (a.width * a.height)) * 10000) / 100;
          if (r.diff_percent > threshold) {
            r.status = "changed";
            fs.writeFileSync(path.join(outDir, `${p.name}.diff.png`), PNG.sync.write(diff));
          }
        }
      }
    } catch (e) {
      r.status = "failed";
      r.error = String(e && e.message ? e.message : e).slice(0, 200);
    }
    console.log(`${r.status.padEnd(8)} ${p.name} ${r.diff_percent}%${r.error ? ` ${r.error}` : ""}`);
    results.push(r);
  }
} finally {
  await browser.close();
}
const problems = results.filter((r) => r.status === "changed" || r.status === "failed");
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ threshold_percent: threshold, results, problems: problems.length }, null, 2));
// 有差異或失敗不讓工作失敗（由 workflow 開 Issue 通知）；只有腳本本身壞掉才會非 0
