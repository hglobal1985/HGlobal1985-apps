/**
 * 行動大學 API 進入點（杜杜龍 2026-11-27 拆檔）：共用核心在 api-core.ts、各功能網址在 routes/*.ts，這裡只組合總路由表與處理請求。
 * 多個 AI 同時開發時各改各的功能檔，比較不會撞在同一個檔案。新增網址：加進對應的 routes 檔；新功能可以新增一個 routes 檔再加進下面的清單。
 */
export * from "./api-core.ts";
import type { Handler } from "./api-core.ts";
import { flushPushes } from "./push.ts";
import { UPGRADING_MSG } from "./contract.ts";
import { flushEmails } from "./email.ts";
import { takeCentralTimings, setBackground } from "./central.ts";
import type { Env } from "./d1.ts";
import { type Ctx, HttpError, fail, json, loadSession, platformOf, touchCourse } from "./api-core.ts";
import { systemRoutes } from "./routes/system.ts";
import { myRoutes } from "./routes/my.ts";
import { coursesRoutes } from "./routes/courses.ts";
import { ordersRoutes } from "./routes/orders.ts";
import { centersRoutes } from "./routes/centers.ts";
import { mediaRoutes } from "./routes/media.ts";
import { recipesRoutes } from "./routes/recipes.ts";
import { syncRoutes } from "./routes/sync.ts";
import { adminCoursesRoutes } from "./routes/admin-courses.ts";
import { adminRoutes } from "./routes/admin.ts";

// 總路由表：依序比對，第一個符合的處理（各功能檔之間的網址不會重疊）。
const routes: [string, RegExp, Handler][] = [...systemRoutes, ...myRoutes, ...coursesRoutes, ...ordersRoutes, ...centersRoutes, ...mediaRoutes, ...recipesRoutes, ...syncRoutes, ...adminCoursesRoutes, ...adminRoutes];


const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** 處理 /api/v2/*；其他路徑交給靜態網站。 */

export async function handleApi(req: Request, env: Env, exec?: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  const cors: Record<string, string> =
    origin && LOCAL_ORIGIN.test(origin)
      ? {
          "access-control-allow-origin": origin,
          "access-control-allow-headers": "authorization, content-type, x-client-platform",
          "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          vary: "origin",
        }
      : {};
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const path = url.pathname.replace(/^\/api\/v2/, "") || "/";
  const started = Date.now();
  let res: Response;
  try {
    const route = routes.find(([m, re]) => m === req.method && re.test(path));
    if (!route) {
      if (routes.some(([, re]) => re.test(path))) fail(405, "method_not_allowed", "不支援這個操作");
      fail(404, "not_found", "找不到這個 API");
    }
    const [, re, handler] = route!;
    setBackground(exec ? (p) => exec.waitUntil(p) : null);
    const ctx = await context(req, env, url);
    if (exec) ctx.defer = (p) => exec.waitUntil(p);
    const out = await handler(ctx, [...re.exec(path)!].slice(1));
    if (ctx.touched && ctx.session) await touchCourse(env.DB, ctx.touched, ctx.session).run().catch(() => undefined);
    res = out instanceof Response ? out : json(out);
  } catch (e) {
    if (e instanceof HttpError) res = json({ error: { code: e.code, message: e.message } }, e.status);
    else {
      console.error("api error", e);
      res = json({ error: { code: "internal", message: UPGRADING_MSG } }, 500);
    }
  }
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  // 伺服器處理時間（含向會員中心查詢），方便在瀏覽器開發者工具的 Network → Timing 看哪一步慢。
  const centralTiming = takeCentralTimings(/^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1]);
  res.headers.set("server-timing", `app;dur=${Date.now() - started}${centralTiming ? `, ${centralTiming}` : ""}`);
  // 有寫入動作時，把新產生的站內通知也寄成 Email、推播到手機（背景處理，失敗不影響回應）。
  if (req.method !== "GET" && res.status < 400 && env.EMAIL) {
    const job = flushEmails(env).catch((e) => console.error("flush emails", e instanceof Error ? e.message : "error"));
    if (exec) exec.waitUntil(job);
    else await job;
  }
  if (req.method !== "GET" && res.status < 400 && env.VAPID_PRIVATE_JWK) {
    const job = flushPushes(env).catch((e) => console.error("flush pushes", e instanceof Error ? e.message : "error"));
    if (exec) exec.waitUntil(job);
    else await job;
  }
  return res;
}

/** 不需要登入身分的公開路徑：不必為它們向會員中心查詢（首頁的公告、金句、設定每次都會打）。 */
const NO_SESSION = /^\/api\/v2\/(announcements|quotes\/random|config|version|client-errors|central\/webhook|internal\/notices|media\/(pub|img|file|audio|dl))(\?|$)/;

async function context(req: Request, env: Env, url: URL): Promise<Ctx> {
  const light = /^\/api\/v2\/me\/(central-profile|vocab)$/.test(url.pathname);
  const session = NO_SESSION.test(url.pathname) ? null : await loadSession(env, req, req.method === "GET" && url.pathname === "/api/v2/me", light);
  return { env, db: env.DB, req, url, platform: platformOf(req), session };
}
