import { handleApi } from "./api.ts";
import type { Env } from "./d1.ts";
import { resolveShareMeta, withShareMeta } from "./og.ts";
import { serveStatic, type StaticFiles } from "./site.ts";

/**
 * learn.hglobal1985.com：/api/v2/* 為 API，其餘為 Expo Web 靜態檔（SPA）。
 * /privacy* 由獨立 Worker learn-legal 透過路由處理。
 */
export function createWorker(staticFiles: StaticFiles) {
  return {
    async fetch(req: Request, env: Env, exec?: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname === "/api/v2" || url.pathname.startsWith("/api/v2/")) return handleApi(req, env, exec);
      if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
      let res = serveStatic(req, staticFiles);
      // 分享預覽（LINE 等不會執行 JavaScript）：所有會被分享的網址形狀（短網址、課程專屬網址、中心／分類／系列／課程／章節）都由 resolveShareMeta 統一帶入標題與圖；找不到就維持預設。
      if (req.method === "GET" && res.status === 200 && (res.headers.get("content-type") ?? "").includes("text/html")) {
        const meta = await resolveShareMeta(env.DB, url).catch(() => null);
        if (meta) {
          const headers = new Headers(res.headers);
          headers.delete("content-length");
          headers.set("cache-control", "no-cache");
          res = new Response(withShareMeta(await res.text(), meta), { status: 200, headers });
        }
      }
      res.headers.set("x-content-type-options", "nosniff");
      res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
      res.headers.set("x-frame-options", "DENY");
      return res;
    },
  };
}

