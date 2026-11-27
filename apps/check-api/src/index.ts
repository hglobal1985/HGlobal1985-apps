/** Cloudflare Worker 進入點：/api/* → API；/f/* → 作業檔案下載（憑證）；/z/* → 一鍵下載備份的壓縮檔（憑證）；其他 → App 網頁版（打包進 Worker 的靜態檔，單頁應用；做法與行動大學相同）。 */
import { files } from "check:static";
import { serveStatic } from "../../launch/src/site.ts";
import { handleApi, handleFile, handleZip, scheduled } from "./api.ts";
import type { Env } from "./env.ts";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
};

export default {
  async fetch(req: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/api/")) return handleApi(req, env, (p) => ctx.waitUntil(p.catch(() => {})));
    if (path.startsWith("/f/")) return handleFile(req, env);
    if (path.startsWith("/z/")) return handleZip(req, env);
    const res = env.ASSETS ? await env.ASSETS.fetch(req) : serveStatic(req, files);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  },
  async scheduled(_e: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(scheduled(env));
  },
};
