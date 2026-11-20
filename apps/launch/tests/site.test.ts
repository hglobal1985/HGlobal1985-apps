import assert from "node:assert/strict";
import { test } from "node:test";
import { serveStatic, type StaticFiles } from "../src/site.ts";

const files: StaticFiles = {
  "/index.html": { type: "text/html; charset=utf-8", data: Buffer.from("<html>app</html>").toString("base64") },
  "/_expo/static/js/web/a.js": { type: "text/javascript; charset=utf-8", data: Buffer.from("console.log(1)").toString("base64") },
};

test("靜態檔：App 路由回 index.html、靜態檔長期快取、找不到的檔案 404", async () => {
  const app = serveStatic(new Request("https://learn.test/course/abc"), files);
  assert.equal(app.status, 200);
  assert.equal(await app.text(), "<html>app</html>");
  const js = serveStatic(new Request("https://learn.test/_expo/static/js/web/a.js"), files);
  assert.match(js.headers.get("cache-control") ?? "", /immutable/);
  assert.equal(serveStatic(new Request("https://learn.test/missing.png"), files).status, 404);
});

test("靜態檔：網址有不完整的 %XX 不會讓網站壞掉（2026-11-21 修正：原本回 500）", async () => {
  const res = serveStatic(new Request("https://learn.test/%E0%A4%A"), files);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "<html>app</html>");
});
