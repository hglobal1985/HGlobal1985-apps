// 把繳作業系統網頁版（apps/check-app/dist）打包成 Worker 模組，部署時不需另外上傳靜態資源（與行動大學同一做法：雲端環境上傳靜態資源會被代理擋下）。
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { subsetFont, usedIconNames } from "../../launch/scripts/subset-icons.mjs";

const root = new URL("../../check-app/dist/", import.meta.url).pathname;
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
  ".txt": "text/plain; charset=utf-8",
};
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
const app = new URL("../../check-app/", import.meta.url).pathname;
const shared = new URL("../../../packages/ui/src/", import.meta.url).pathname;
function slimIcons(path, data) {
  if (!/\/Ionicons\.[0-9a-f]+\.ttf$/.test(path)) return data;
  try {
    const map = JSON.parse(readFileSync(new URL("../../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json", import.meta.url), "utf8"));
    const used = usedIconNames([join(app, "src"), join(app, "app"), shared], map);
    const r = subsetFont(data, [...used].map((n) => map[n]));
    console.log(`icon font: kept ${r.kept}/${r.total} glyphs`);
    return r.font;
  } catch (e) {
    console.warn("icon font subset skipped:", e instanceof Error ? e.message : e);
    return data;
  }
}
const files = {};
let bytes = 0;
for (const file of walk(root)) {
  const path = "/" + relative(root, file).split("\\").join("/");
  const data = slimIcons(path, readFileSync(file));
  bytes += data.length;
  files[path] = { type: types[extname(file).toLowerCase()] ?? "application/octet-stream", data: data.toString("base64") };
}
if (!files["/index.html"]) throw Error("找不到 apps/check-app/dist/index.html，請先執行 npx expo export --platform web（apps/check-app）");
let html = Buffer.from(files["/index.html"].data, "base64").toString("utf8");
// 與行動大學相同：鎖定 1 倍不可縮放、畫面釘住、網頁還沒載入完時顯示「灌溉中」小樹苗。
html = html.replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/>');
html = html.replace("</head>", '<meta name="theme-color" content="#0C603C"/><link rel="manifest" href="/manifest.webmanifest"/><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"/><meta name="apple-mobile-web-app-capable" content="yes"/><meta name="apple-mobile-web-app-title" content="寰宇繳作業系統"/><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/><style id="hg-fixed">html,body{position:fixed;top:0;left:0;right:0;bottom:0;width:100%;overflow:hidden;overscroll-behavior:none}#root{position:absolute;top:0;left:0;right:0;bottom:0;height:auto}#hg-boot{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#F8F6EF;color:#0C603C;font:700 15px -apple-system,"PingFang TC","Noto Sans TC",sans-serif}@media (prefers-color-scheme:dark){#hg-boot{background:#121515;color:#5DB383}}</style></head>');
html = html.replace('<div id="root"></div>', '<div id="root"><div id="hg-boot" role="status" aria-label="載入中">灌溉中…</div></div>');
files["/index.html"].data = Buffer.from(html, "utf8").toString("base64");
mkdirSync(new URL("../.generated/", import.meta.url), { recursive: true });
writeFileSync(out, `export const files = ${JSON.stringify(files)};\n`);
console.log(`embedded ${Object.keys(files).length} files, ${(bytes / 1024).toFixed(0)} KiB`);
