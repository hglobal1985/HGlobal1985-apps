/** 行動大學 API 路由：系統：健康檢查、版本、設定、錯誤回報、名言、公告、使用統計回報、搜尋索引（杜杜龍 2026-11-27 從 api.ts 拆出；順序會影響比對，同一檔內照原本順序）。 */
import { DEMO_MEMBERS, type Announcement } from "../contract.ts";
import { centerKey, errorDigest, forgetMember, verifyWebhook, APP_ID } from "../central.ts";
import { loadConfig } from "../ui-config.ts";
import { isOwnerDevice, isOwnerNet, markOwnerNet, recordUsage } from "../usage.ts";
import { HOME_BC_KEY, REVIEW_FIELD_LABEL, SESSION_DAYS, type Session, audit, clientErrorHits, demoEnabled, fail, isOwnerSession, iso, memberOf, notifyReviewResult, pubUrl, purgeMember, randomToken, ranks, readJson, sha256, usageHits, ytThumbOf } from "../api-core.ts";
import type { Handler } from "../api-core.ts";

export const systemRoutes: [string, RegExp, Handler][] = [
  ["GET", /^\/health$/, async () => ({ ok: true })],
  ["GET", /^\/ranks$/, async (ctx) => [...(await ranks(ctx.db)).values()]],
  ["GET", /^\/config$/, async (ctx) => ({ demoLogin: demoEnabled(ctx.env) })],
  // 正式站目前的程式版本（多個 AI 接手開發時，部署前用它確認自己的程式包含線上版本，才不會蓋掉別人的成果）。
  ["GET", /^\/version$/, async (ctx) => ({ sha: ctx.env.GIT_SHA ?? null })],
  // 前台錯誤回報（杜杜龍 2026-11-21）：使用者畫面出錯時 App 自動送來，只寫進 Cloudflare 錯誤紀錄（不存資料庫、不記會員身分），每週自動檢查會看。
  ["POST", /^\/client-errors$/, async (ctx) => {
    const ip = ctx.req.headers.get("cf-connecting-ip") ?? "";
    const now = Date.now();
    const hit = clientErrorHits.get(ip);
    if (hit && now - hit.at < 60_000 && hit.n >= 10) return { ok: true }; // 同一來源每分鐘最多 10 則，避免洗版
    clientErrorHits.set(ip, hit && now - hit.at < 60_000 ? { at: hit.at, n: hit.n + 1 } : { at: now, n: 1 });
    if (clientErrorHits.size > 500) clientErrorHits.delete(clientErrorHits.keys().next().value!);
    const b = await readJson<Record<string, unknown>>(ctx.req);
    const str = (k: string, max: number) => (typeof b[k] === "string" ? (b[k] as string).slice(0, max) : "");
    console.error("client error", JSON.stringify({ kind: str("kind", 20), message: str("message", 300), page: str("page", 200), platform: str("platform", 10), ua: str("ua", 200), extra: str("extra", 300), stack: str("stack", 1500) }));
    errorDigest.record(str("kind", 20), str("page", 200), ctx.defer); // 只累加種類＋頁面路徑＋次數，批次送中央週報（生態系統功能 3）
    return { ok: true };
  }],
  [
    "GET",
    /^\/demo-members$/,
    async (ctx) => {
      if (!demoEnabled(ctx.env)) fail(404, "not_found", "找不到這個 API");
      const rankMap = await ranks(ctx.db);
      return DEMO_MEMBERS.map((m) => ({ sub: m.sub, name: m.name, role: m.role, rank: rankMap.get(m.rankCode), demo: true }));
    },
  ],
  [
    "POST",
    /^\/auth\/demo$/,
    async (ctx) => {
      if (!demoEnabled(ctx.env)) fail(404, "not_found", "找不到這個 API");
      const { sub } = await readJson<{ sub?: string }>(ctx.req);
      const m = DEMO_MEMBERS.find((x) => x.sub === sub) ?? fail(400, "unknown_member", "請選擇測試會員");
      const token = randomToken();
      const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
      await ctx.db
        .prepare("INSERT INTO sessions (token_hash, member_sub, display_name, rank_code, role, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(await sha256(token), m.sub, m.name, m.rankCode, m.role, iso(expires))
        .run();
      const session: Session = { kind: "demo", sub: m.sub, name: m.name, rankCode: m.rankCode, role: m.role, roles: m.roles ?? [], hglobal: m.hglobal ?? false, center: m.center ? { key: centerKey(m.center), label: m.center } : null };
      return { token, member: memberOf(session, await ranks(ctx.db)) };
    },
  ],
  [
    "POST",
    /^\/auth\/logout$/,
    async (ctx) => {
      const token = /^Bearer (.+)$/.exec(ctx.req.headers.get("authorization") ?? "")?.[1];
      if (token) await ctx.db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/central\/webhook$/,
    async (ctx) => {
      // 會員中心事件通知：驗簽 → 依事件編號去重 → 處理。5 秒內回 2xx。
      const secret = ctx.env.CENTRAL_WEBHOOK_SECRET;
      if (!secret) return fail(503, "not_configured", "尚未設定 webhook 金鑰");
      const raw = await ctx.req.text();
      if (!(await verifyWebhook(secret, ctx.req.headers.get("x-hg-timestamp"), ctx.req.headers.get("x-hg-signature"), raw))) return fail(401, "bad_signature", "簽章不正確");
      let ev: { id?: unknown; type?: unknown; member_id?: unknown; app_id?: unknown };
      try {
        ev = JSON.parse(raw);
      } catch {
        return fail(400, "invalid_request", "內容格式不正確");
      }
      if (typeof ev.id !== "string" || typeof ev.type !== "string" || (ev.app_id !== undefined && ev.app_id !== APP_ID)) return fail(400, "invalid_request", "內容格式不正確");
      const seen = await ctx.db.prepare("SELECT 1 AS x FROM central_events WHERE id = ?").bind(ev.id).first();
      if (seen) return { ok: true, duplicate: true };
      if (ev.type === "member.deleted" && typeof ev.member_id === "string") await purgeMember(ctx.db, ev.member_id, "central", "member.deleted_by_central");
      else if (ev.type === "member.profile_changed" && typeof ev.member_id === "string") {
        forgetMember(ev.member_id);
        // 獎銜、中心、系統被核准或改變時，通知本人。事件內容的欄位清單格式未確認，所以寬鬆讀取 fields／changed_fields／keys；
        // 同時把「有哪些欄位名稱」（不含值）記進稽核紀錄，方便對照中央實際格式。
        const evx = ev as Record<string, unknown>;
        const raw = [evx.fields, evx.changed_fields, evx.keys, evx.changed].flat().filter((x): x is string => typeof x === "string");
        await audit(ctx.db, "central", "webhook.profile_changed", "member", ev.member_id, Object.keys(evx).join(",").slice(0, 200) + "|" + raw.join(",").slice(0, 200)).run().catch(() => undefined);
        const hit = raw.map((k) => k.replace(/^amway\./, "")).filter((k) => k in REVIEW_FIELD_LABEL);
        if (hit.length) await notifyReviewResult(ctx.db, ev.member_id, [...new Set(hit.map((k) => REVIEW_FIELD_LABEL[k]!))].join("、")).catch(() => undefined);
      }
      // webhook.test 與不認得的事件：只回 2xx（容忍未來新增的事件）。
      await ctx.db.batch([
        ctx.db.prepare("INSERT OR IGNORE INTO central_events (id) VALUES (?)").bind(ev.id),
        ctx.db.prepare("DELETE FROM central_events WHERE received_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')"),
      ]);
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/search-index$/,
    async (ctx) => {
      // 「全部課程」搜尋與「章節」模式用：已上架課程每一堂的章節標題、分享者（姓名、獎銜、職稱）、日期、長度，
      // 登入時再帶「這位會員是否已完成」。公開資料（章節標題本來就顯示在課程頁），只回需要的欄位。
      const rankMap = await ranks(ctx.db);
      const sub = ctx.session?.sub ?? "";
      const me = ctx.session;
      // 誰可以瀏覽：訪客只看「所有人」且沒勾「對訪客隱藏」的；登入者依身份；已報名的課程照常。
      const scopeSql = !me
        ? "c.view_scope = 'all'"
        : me.role === "admin"
          ? "c.view_scope NOT IN ('link_login', 'link_guest')"
          : `(c.view_scope IN ('all', 'members'${me.hglobal ? ", 'hglobal'" : ""}${me.center ? ", 'center'" : ""}) OR (c.view_scope NOT IN ('link_login', 'link_guest') AND c.id IN (SELECT course_id FROM enrollments WHERE member_sub = ?)))`;
      const { results } = await ctx.db
        .prepare(
          `SELECT l.id AS id, l.course_id AS courseId, l.position AS position, l.title, l.sharer, l.sharer_rank AS sharerRank, l.sharer_title AS sharerTitle, COALESCE(l.event_date, c.event_start) AS eventDate, l.is_speaker AS isSpeaker, l.is_summary AS isSummary, (c.is_shorts = 1 OR c.is_list = 1) AS isShorts, c.is_list AS isList, l.kind AS lessonKind, l.duration_minutes AS minutes, l.media_type AS mediaType, l.media_ref AS mediaRef, l.cover_key AS coverKey, l.art_version AS artVersion, (SELECT 1 FROM lesson_progress p WHERE p.lesson_id = l.id AND p.member_sub = ?) AS done FROM lessons l JOIN courses c ON c.id = l.course_id WHERE c.status = 'published' AND ${scopeSql} AND (l.kind = 'chapter' OR ((c.is_shorts = 1 OR c.is_list = 1) AND l.kind = 'material' AND l.media_type <> 'demo' AND l.media_ref IS NOT NULL)) ORDER BY l.course_id, l.position`,
        )
        .bind(...(me && me.role !== "admin" ? [sub, sub] : [sub]))
        .all<{ id: string; courseId: string; position: number; title: string; sharer: string; sharerRank: string; sharerTitle: string; eventDate: string | null; isSpeaker: number; isSummary: number; isShorts: number; isList: number; lessonKind: string; minutes: number; mediaType: string; mediaRef: string | null; coverKey: string | null; artVersion: number; done: number | null }>();
      return {
        lessons: results.map((r) => ({
          id: r.id,
          courseId: r.courseId,
          position: r.position,
          title: r.title,
          sharer: r.sharer,
          sharerRankName: rankMap.get(r.sharerRank)?.name ?? "",
          sharerTitle: r.sharerTitle,
          eventDate: r.eventDate,
          isSpeaker: r.isSpeaker === 1,
          isSummary: r.isSummary === 1,
          isShorts: r.isShorts === 1,
          isMaterial: r.lessonKind === "material",
          minutes: r.minutes,
          // 上傳的封面優先；沒有且是 YouTube 影片＝YouTube 縮圖（杜杜龍 2026-11-25）；其餘留空，畫面改用課程封面。
          coverUrl: r.coverKey ? pubUrl(r.coverKey, r.artVersion) : ytThumbOf(r.mediaType, r.mediaRef),
          ready: (r.mediaType !== "demo" && !!r.mediaRef) || r.minutes > 0,
          completed: r.done === 1,
        })),
      };
    },
  ],
  ["GET", /^\/ui-config$/, async (ctx) => loadConfig(ctx.db)],
  // 使用統計（杜杜龍 2026-11-22）：App 匿名回報裝置、系統、時段與首頁卡片點閱（訪客也可；格式不對就略過）；管理員交叉查詢。
  ["POST", /^\/usage$/, async (ctx) => {
    const ip = ctx.req.headers.get("cf-connecting-ip") ?? "";
    const now = Date.now();
    const hit = usageHits.get(ip);
    if (hit && hit.t > now - 60_000 && hit.n >= 60) return { ok: true };
    usageHits.set(ip, hit && hit.t > now - 60_000 ? { t: hit.t, n: hit.n + 1 } : { t: now, n: 1 });
    if (usageHits.size > 2000) usageHits.clear();
    const body = await readJson<Record<string, unknown>>(ctx.req).catch(() => ({}) as Record<string, unknown>);
    // 杜杜龍本人的操作不列入統計（2026-11-23）：管理員帳號、管理員用過的裝置（App 帶 owner=1）、管理員用過的網路（無痕／未登入也認得）。
    const adminNow = isOwnerSession(ctx.session);
    if (adminNow) await markOwnerNet(ctx.db, ip).catch(() => undefined);
    const mine = adminNow || body.owner === 1 || (await isOwnerNet(ctx.db, ip).catch(() => false)) || (await isOwnerDevice(ctx.db, body.fp, ip).catch(() => false));
    await recordUsage(ctx.db, body, mine).catch(() => undefined);
    return { ok: true };
  }],
  // 管理員登入後，App 通知一次：記下這個網路（裝置記號由 App 自己存）。
  ["POST", /^\/usage\/owner$/, async (ctx) => {
    if (!isOwnerSession(ctx.session)) return { ok: false };
    await markOwnerNet(ctx.db, ctx.req.headers.get("cf-connecting-ip") ?? "").catch(() => undefined);
    return { ok: true };
  }],
  [
    "GET",
    /^\/quotes\/random$/,
    async (ctx) => {
      const r = await ctx.db.prepare("SELECT body FROM quotes ORDER BY RANDOM() LIMIT 1").first<{ body: string }>();
      return { text: r?.body ?? null };
    },
  ],
  [
    "GET",
    /^\/announcements$/,
    async (ctx) => {
      // 首頁跑馬燈：公開（未登入也看得到）；資料來自統一的公告表（範圍＝首頁，新的在前）。
      const { results } = await ctx.db.prepare("SELECT id, body FROM center_broadcasts WHERE center_key = ? ORDER BY created_at DESC, rowid DESC LIMIT 20").bind(HOME_BC_KEY).all<{ id: string; body: string }>();
      return results.map((r): Announcement => ({ id: r.id, text: r.body, enabled: true }));
    },
  ],
];
