// 把 Expo Web 輸出（apps/mobile/dist）打包成 Worker 模組，部署時不需另外上傳靜態資源。
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { subsetFont, usedIconNames } from "./subset-icons.mjs";

const root = new URL("../../mobile/dist/", import.meta.url).pathname;
const out = new URL("../.generated/static-files.js", import.meta.url).pathname;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
};

const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
const files = {};
let bytes = 0;
// 圖示字型瘦身（見 subset-icons.mjs）：只保留 App 原始碼用到的圖示，失敗就用完整字型。
const mobile = new URL("../../mobile/", import.meta.url).pathname;
function slimIcons(path, data) {
  if (!/\/Ionicons\.[0-9a-f]+\.ttf$/.test(path)) return data;
  try {
    const map = JSON.parse(readFileSync(new URL("../../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json", import.meta.url), "utf8"));
    const used = usedIconNames([join(mobile, "src"), join(mobile, "app")], map);
    const r = subsetFont(data, [...used].map((n) => map[n]));
    console.log(`icon font: kept ${r.kept}/${r.total} glyphs, ${(data.length / 1024).toFixed(0)} → ${(r.font.length / 1024).toFixed(0)} KiB`);
    return r.font;
  } catch (e) {
    console.warn("icon font subset skipped:", e instanceof Error ? e.message : e);
    return data;
  }
}
for (const file of walk(root)) {
  const path = "/" + relative(root, file).split("\\").join("/");
  const data = slimIcons(path, readFileSync(file));
  bytes += data.length;
  files[path] = { type: types[extname(file).toLowerCase()] ?? "application/octet-stream", data: data.toString("base64") };
}
// 桌面／主畫面圖示：Expo 單頁輸出不會自動加這些標籤，這裡統一補上（網頁「加到主畫面」與瀏覽器分頁都用同一個圖案）。
if (files["/index.html"]) {
  const tags = [
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"/>',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"/>',
    '<link rel="manifest" href="/manifest.webmanifest"/>',
    '<meta name="theme-color" content="#2F5D3A"/>',
    '<meta name="apple-mobile-web-app-capable" content="yes"/>',
    '<meta name="apple-mobile-web-app-title" content="寰宇行動大學"/>',
    // 一般網址分享到 LINE 等的預設預覽（短網址的預覽由 Worker 依內容替換，見 src/og.ts）。
    '<meta name="description" content="寰宇行動大學"/>',
    '<meta property="og:site_name" content="寰宇行動大學"/>',
    '<meta property="og:type" content="website"/>',
    '<meta property="og:title" content="寰宇行動大學"/>',
    '<meta property="og:description" content="寰宇行動大學"/>',
    '<meta property="og:image" content="https://learn.hglobal1985.com/icon-512.png"/>',
  ].join("");
  const html = Buffer.from(files["/index.html"].data, "base64").toString("utf8");
  let out = html;
  if (!out.includes("apple-touch-icon")) out = out.replace("</head>", `${tags}</head>`);
  // iPhone 的瀏海／狀態列／底部橫條「安全區」：viewport-fit=cover 才能讓 App 內量到安全區；狀態列用半透明樣式，畫面延伸到狀態列底下，
  // 由 App 自己（app/_layout.tsx）把標題列與狀態列底色處理好。
  out = out.replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>');
  if (!out.includes("apple-mobile-web-app-status-bar-style")) out = out.replace("</head>", '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/></head>');
  // 整個畫面釘死在可視範圍（position:fixed）：Chrome 網址列伸縮、安裝到桌面的捷徑，底部選單都不會被推出畫面；也不讓整頁被拖動。
  if (!out.includes("hg-fixed")) out = out.replace("</head>", '<style id="hg-fixed">html,body{position:fixed;top:0;left:0;right:0;bottom:0;width:100%;overflow:hidden;overscroll-behavior:none}#root{position:absolute;top:0;left:0;right:0;bottom:0;height:auto}</style></head>');
  // 網頁一開啟、程式還沒載入完時的「灌溉小樹苗」開機畫面（業主 2026-11-17：還沒讀取完成以前一律用灌溉動畫）：放在 #root 裡，App 一掛載就被取代。
  if (!out.includes("hg-boot")) {
    const css = "@media (min-width:600px){#hg-boot svg{width:450px;height:337px}#hg-boot{font-size:26px!important}}#hg-boot{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:#F8F6EF;color:#0C603C;font:700 15px -apple-system,'PingFang TC','Noto Sans TC',sans-serif}@media (prefers-color-scheme:dark){#hg-boot{background:#121515;color:#5DB383}}#hg-boot .g{transform-box:fill-box;transform-origin:50% 100%;animation:hgb-g 1.2s ease-in-out infinite}@keyframes hgb-g{0%,12%{transform:scale(.28)}78%,100%{transform:scale(1.12)}}#hg-boot .d span{display:inline-block;width:5px;height:5px;border-radius:50%;margin-left:3px;background:currentColor;animation:hgb-d .8s infinite}#hg-boot .d span:nth-child(2){animation-delay:.15s}#hg-boot .d span:nth-child(3){animation-delay:.3s}@keyframes hgb-d{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-4px);opacity:1}}";
    const svg = '<svg viewBox="40 60 120 90" width="150" height="112" aria-hidden="true"><g class="g"><path d="M96 128 V92" stroke="#0C603C" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M96 100 C84 98 76 90 76 80 C88 80 96 88 96 100Z" fill="#2F8A5B"/><path d="M96 92 C106 90 114 82 114 72 C102 72 96 80 96 92Z" fill="#5DB383"/></g><ellipse cx="96" cy="132" rx="30" ry="8" fill="#8A6A4B"/><path d="M66 132 q30 14 60 0 v6 q-30 14 -60 0z" fill="#6E5239"/></svg>';
    out = out.replace("</head>", `<style id="hg-boot-css">${css}</style></head>`).replace('<div id="root"></div>', `<div id="root"><div id="hg-boot" role="status" aria-label="載入中">${svg}<div>灌溉中<span class="d"><span></span><span></span><span></span></span></div></div></div>`);
  }
  files["/index.html"].data = Buffer.from(out, "utf8").toString("base64");
}
if (!files["/index.html"]) throw Error("找不到 apps/mobile/dist/index.html，請先執行 npm run build:web -w @learn/mobile");
mkdirSync(new URL("../.generated/", import.meta.url), { recursive: true });
writeFileSync(out, `export const files = ${JSON.stringify(files)};\n`);
console.log(`embedded ${Object.keys(files).length} files, ${(bytes / 1024).toFixed(0)} KiB`);
