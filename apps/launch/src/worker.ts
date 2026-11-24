import { revokeLegacyDriveLink } from "./material-files.ts";
import { ensureBrandCards } from "./brand-cards.ts";
import { ensureTreasureLinks } from "./treasure-box.ts";
import { backfillYoutube } from "./youtube.ts";
import { processFirstSyncs, processImportJobs } from "./imports.ts";
import { indexSearchVectors } from "./semantic-search.ts";
import { handleApi } from "./api.ts";
import type { Env } from "./d1.ts";
import { resolveShareMeta, withShareMeta } from "./og.ts";
import { serveStatic, type StaticFiles } from "./site.ts";
import { courseReminders, flushPushes } from "./push.ts";

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
    /** 排程（每 10 分鐘）：開課前一天提醒（台灣時間 20:00 後）、補推還沒推播的通知。 */
    async scheduled(_event: unknown, env: Env, exec?: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
      const job = (async () => {
        await revokeLegacyDriveLink(env.DB).catch((e) => console.error("legacy drive cleanup", e instanceof Error ? e.message : "error")); // 舊的「業主雲端硬碟上傳」授權：撤銷並刪除（業主 2026-11-18 取消該功能）
        await courseReminders(env).catch((e) => console.error("course reminders", e instanceof Error ? e.message : "error"));
        await processImportJobs(env).catch((e) => console.error("import jobs", e instanceof Error ? e.message : "error"));
        await processFirstSyncs(env).catch((e) => console.error("first syncs", e instanceof Error ? e.message : "error"));
        await ensureBrandCards(env).catch((e) => console.error("brand cards", e instanceof Error ? e.message : "error"));
        await ensureTreasureLinks(env).catch((e) => console.error("treasure links", e instanceof Error ? e.message : "error")); // 實戰百寶箱 ↔ 品牌館（業主 2026-11-24）
        await backfillYoutube(env).catch((e) => console.error("youtube backfill", e instanceof Error ? e.message : "error"));
        await indexSearchVectors(env).catch((e) => console.error("search vectors", e instanceof Error ? e.message : "error"));
        await flushPushes(env).catch((e) => console.error("flush pushes", e instanceof Error ? e.message : "error"));
      })();
      if (exec) exec.waitUntil(job);
      else await job;
    },
  };
}

