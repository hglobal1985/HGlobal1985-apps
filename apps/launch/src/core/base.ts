/** 行動大學 API 共用核心：基礎：型別、共用小工具、登入身分、資料讀取輔助（杜杜龍 2026-11-27 從 api-core.ts 依功能拆出；api-core.ts 會全部轉出，舊的 import 不用改）。 */
import { DEMO_MEMBERS, ACHIEVEMENT_TYPES, ACH_UNITS, iconText, type AchievementType, type AdminAchievement, type ClientPlatform, type Member, type NoticeCategory, type BrandCover, FEATURES, type Rank } from "../contract.ts";
import { amwayMe, centerKey, forgetMember, profileSummary, isAdmin, looksLikeJwt, memberContext, rankEligibility, verifyAccessToken } from "../central.ts";
import type { D1Database, D1PreparedStatement, Env } from "../d1.ts";
import { evaluateAchievements } from "../achievements.ts";
import { loadConfig } from "../ui-config.ts";
import { pubUrl } from "./course-admin.ts";
import { text } from "./library.ts";

export const SESSION_DAYS = 30;
export const DEMO_VIDEO_PATH = "/media/orientation.mp4";

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const fail = (status: number, code: string, message: string): never => {
  throw new HttpError(status, code, message);
};

/** demo：模擬會員（rankCode 為示範獎銜）；central：中央會員（不持有獎銜，資格每次向中央查詢）。 */
export type SessionBase = { sub: string; name: string; role: "student" | "admin"; roles: string[]; hglobal: boolean; center: { key: string; label: string } | null };
export type Session = SessionBase & ({ kind: "demo"; rankCode: string } | { kind: "central"; token: string; avatarUrl: string | null; rankValue?: string | null; rankLabel?: string });
export type Ctx = { env: Env; db: D1Database; req: Request; url: URL; platform: ClientPlatform; session: Session | null; /** 回應送出後才做的背景工作（沒有執行環境時為 undefined，呼叫端就改成等它做完）。 */ defer?: (p: Promise<unknown>) => void; touched?: string; /** 品牌 logo（組課程封面用，列表／詳情載入）。 */ brands?: BrandRow[]; /** 清單的區塊（顯示在上拉選單的）：courseId → 區塊。 */ blocks?: Map<string, SheetBlock[]>; /** 中心縮寫（centerKey → slug），列表／詳情組課程網址用。 */ centerSlugs?: Map<string, string>; seriesSlugs?: Map<string, string> };

export type BrandRow = { id: string; name: string; logo_key: string | null; bg_key: string | null; bg_color: string | null; bg_color_dark: string | null; categories: string; art_version: number };
export const loadBrands = async (db: D1Database): Promise<BrandRow[]> => (await db.prepare("SELECT id, name, logo_key, bg_key, bg_color, bg_color_dark, categories, art_version FROM brand_logos WHERE logo_key IS NOT NULL ORDER BY sort_order, created_at").all<BrandRow>()).results;
/** 課程的品牌封面（杜杜龍 2026-11-18）：選了品牌、而且沒有手動上傳封面／EDM 才用品牌 logo（手動上傳 > 品牌 logo > 文字封面）。 */
export function brandFor(ctx: Ctx, row: { brand_id?: string | null; edm_key?: string | null; cover_key?: string | null }): BrandCover | null {
  if (!row.brand_id || row.edm_key || row.cover_key) return null;
  const b = ctx.brands?.find((x) => x.id === row.brand_id);
  return b?.logo_key ? { logoUrl: brandUrl(b.logo_key, b.art_version), bgColor: b.bg_color, bgColorDark: b.bg_color_dark, bgUrl: b.bg_key ? brandUrl(b.bg_key, b.art_version) : null } : null;
}
/** 清單的區塊（只列勾了「顯示在上拉選單」的）：上拉選單用；count＝底下有內容的素材數。 */
export type SheetBlock = { id: string; title: string; coverUrl: string | null; brand: BrandCover | null; count: number; categories: string; brandId: string | null; /** 連結區塊：內容在另一份清單（不算在這份清單自己的教材數裡）。 */ linked?: boolean };
export async function loadBlocks(db: D1Database): Promise<Map<string, SheetBlock[]>> {
  const { results } = await db
    .prepare("SELECT l.id, l.course_id, l.kind, l.title, l.cover_key, l.art_version, l.brand_id, l.categories, l.in_sheet, l.link_block_id, (l.media_type <> 'demo' AND l.media_ref IS NOT NULL) OR EXISTS (SELECT 1 FROM lesson_attachments a WHERE a.lesson_id = l.id) AS has FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.course_id IN (SELECT course_id FROM lessons WHERE kind = 'section') AND l.is_full = 0 ORDER BY l.course_id, l.position")
    .all<{ id: string; course_id: string; kind: string; title: string; cover_key: string | null; art_version: number; brand_id: string | null; categories: string; in_sheet: number; link_block_id: string | null; has: number }>();
  const brands = await loadBrands(db);
  const counts = new Map<string, number>(); // 每個區塊底下有內容的素材數（連結區塊要用來源區塊的數字）
  const links: { block: SheetBlock; src: string }[] = [];
  let any: string | null = null;
  const map = new Map<string, SheetBlock[]>();
  let cur: SheetBlock | null = null;
  let curCourse = "";
  let curShown = false;
  for (const r of results) {
    if (r.course_id !== curCourse) {
      curCourse = r.course_id;
      cur = null;
    }
    if (r.kind === "section") {
      any = r.id;
      curShown = r.in_sheet === 1;
      cur = null;
      if (curShown) {
        const b = r.brand_id ? brands.find((x) => x.id === r.brand_id) : undefined;
        const brand: BrandCover | null = !r.cover_key && b?.logo_key ? { logoUrl: brandUrl(b.logo_key, b.art_version), bgColor: b.bg_color, bgColorDark: b.bg_color_dark, bgUrl: b.bg_key ? brandUrl(b.bg_key, b.art_version) : null } : null;
        cur = { id: r.id, title: r.title, coverUrl: r.cover_key ? pubUrl(r.cover_key, r.art_version) : null, brand, count: 0, categories: r.categories, brandId: r.brand_id, ...(r.link_block_id ? { linked: true } : {}) };
        if (r.link_block_id) links.push({ block: cur, src: r.link_block_id });
        const list = map.get(r.course_id) ?? [];
        list.push(cur);
        map.set(r.course_id, list);
      }
    } else if (r.has && any) counts.set(any, (counts.get(any) ?? 0) + 1);
    if (r.kind !== "section" && cur && r.has) cur.count++;
  }
  // 區塊照片也算內容（杜杜龍 2026-11-24：沒內容的區塊不對外展示，有照片就不是空的）。
  const photoCounts = new Map<string, number>(
    (await db.prepare("SELECT owner_key, COUNT(*) AS n FROM cover_media WHERE owner_kind = 'course' AND scope = 'cover' GROUP BY owner_key").all<{ owner_key: string; n: number }>()).results.map((r) => [r.owner_key, r.n]),
  );
  for (const list of map.values()) for (const b of list) if (!links.some((l) => l.block === b)) b.count += photoCounts.get(b.id) ?? 0;
  if (links.length) {
    // 連結區塊（品牌資訊卡）：數量用來源區塊的；封面＝來源清單的系列封面。
    const arts = (await db.prepare("SELECT c.id, COALESCE(a.cover_key, a.edm_key, c.cover_key) AS cover_key, NULL AS edm_key, COALESCE(a.art_version, c.art_version) AS art_version FROM courses c LEFT JOIN series_art a ON a.series = c.series AND c.series <> ''").all<{ id: string; cover_key: string | null; edm_key: string | null; art_version: number }>()).results;
    const srcCourse = new Map(results.filter((r) => r.kind === "section").map((r) => [r.id, r.course_id]));
    for (const { block, src } of links) {
      block.count = (counts.get(src) ?? 0) + (photoCounts.get(src) ?? 0);
      const a = arts.find((x) => x.id === srcCourse.get(src));
      const key = a?.cover_key || a?.edm_key;
      if (a && key) block.coverUrl = pubUrl(key, a.art_version);
    }
  }
  return map;
}
/** 區塊的品牌封面：選了品牌、而且區塊沒有自己上傳的封面才用品牌 logo。 */
export function brandForBlock(ctx: Ctx, brandId: string | null, coverKey: string | null): BrandCover | null {
  return brandFor(ctx, { brand_id: brandId, cover_key: coverKey });
}
export const brandUrl = (key: string, v: number) => `/api/v2/media/pub?k=${encodeURIComponent(key)}&v=${v}`;


// ---------- helpers ----------

export function platformOf(req: Request): ClientPlatform {
  const p = req.headers.get("x-client-platform");
  return p === "ios" || p === "android" ? p : "web";
}

export function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function sha256(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
export function randomToken(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** 付款代碼：P＋8 碼（去掉易混淆字元），唯一；匯款備註填寫，對帳以代碼為準。 */
export function payRef(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `P${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => alphabet[b % alphabet.length]).join("")}`;
}
export function orderId(now: Date): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rand = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => alphabet[b % alphabet.length]).join("");
  return `ORD-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${rand}`;
}
export const iso = (d = new Date()) => d.toISOString();

export const clientErrorHits = new Map<string, { at: number; n: number }>();
export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return fail(400, "bad_json", "請求格式錯誤");
  }
}

export function requireMember(ctx: Ctx): Session {
  return ctx.session ?? fail(401, "unauthenticated", "請先登入");
}
/** 最高管理員（超級管理員）；總部秘書沒有這個權限。 */
export function requireSuperAdmin(ctx: Ctx): Session {
  const s = requireMember(ctx);
  if (!s.roles.includes("super_admin")) fail(403, "forbidden", "只有超級管理員可以使用");
  return s;
}
export function requireAdmin(ctx: Ctx): Session {
  const s = requireMember(ctx);
  if (s.role !== "admin") fail(403, "forbidden", "需要管理員權限");
  return s;
}

export const demoEnabled = (env: Env) => env.DEMO_LOGIN === "on";

/** 會員最新暱稱與頭像（migration 0135 member_profiles）：登入使用時只有「變動」才寫入，相簿上傳者標記永遠顯示最新版本（杜杜龍 2026-11-25）。 */
export const profMemo = new Map<string, string>();
export async function touchProfile(db: D1Database, sub: string, name: string, avatar: string | null): Promise<void> {
  if (!name || name === "會員") return;
  const sig = `${name}|${avatar ?? ""}`;
  if (profMemo.get(sub) === sig) return;
  profMemo.set(sub, sig);
  await db
    .prepare("INSERT INTO member_profiles (sub, name, avatar, updated_at) VALUES (?1, ?2, ?3, datetime('now')) ON CONFLICT(sub) DO UPDATE SET name = ?2, avatar = ?3, updated_at = datetime('now') WHERE name <> ?2 OR avatar <> ?3")
    .bind(sub, name.slice(0, 60), (avatar ?? "").slice(0, 500))
    .run()
    .catch(() => void profMemo.delete(sub));
}

export async function loadSession(env: Env, req: Request, warmAmway = false, light = false): Promise<Session | null> {
  const db = env.DB;
  const auth = req.headers.get("authorization") ?? "";
  const jwt = /^Bearer (\S+)$/.exec(auth)?.[1];
  if (jwt && looksLikeJwt(jwt)) {
    const sub = await verifyAccessToken(jwt);
    if (!sub) return null;
    // 「完善資料」視窗的請求只需要知道是誰（帶著會員本人的 Token 轉給會員中心），不必先問名稱與職務，省下一趟。
    if (light) return { kind: "central", sub, name: "", avatarUrl: null, role: "student", token: jwt, roles: [], hglobal: false, center: null };
    // 向會員中心的查詢同時送出（/me 還會順便預先查好 Amway 資料，後面直接用快取）。
    // 名稱頭像、Amway 預查只是顯示用：查詢本身出錯也不能讓整個請求失敗（2026-11-21）；權限（職務）不在這裡吞掉錯誤，避免管理員被誤判降級。
    const [prof, superAdmin, mc] = await Promise.all([profileSummary(sub, jwt).catch(() => ({ name: "會員", avatarUrl: null })), isAdmin(sub, jwt, env.LEARN_ADMIN_SUBS), memberContext(sub, jwt), warmAmway ? amwayMe(sub, jwt).catch(() => undefined) : undefined]);
    // 管理員（可管理課程、審核全部報名）＝超級管理員、總部秘書，或 LEARN_ADMIN_SUBS 指定的會員。
    const admin = superAdmin || mc.roles.includes("super_admin") || mc.roles.includes("secretary");
    await touchProfile(db, sub, prof.name, prof.avatarUrl);
    return { kind: "central", sub, name: prof.name, avatarUrl: prof.avatarUrl, role: admin ? "admin" : "student", token: jwt, roles: mc.roles, hglobal: mc.hglobal, center: mc.center };
  }
  if (!demoEnabled(env)) return null;
  const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(auth);
  if (!m) return null;
  const row = await db
    .prepare("SELECT member_sub, display_name, rank_code, role FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256(m[1]), iso())
    .first<{ member_sub: string; display_name: string; rank_code: string; role: "student" | "admin" }>();
  if (!row) return null;
  const d = DEMO_MEMBERS.find((x) => x.sub === row.member_sub);
  return {
    kind: "demo",
    sub: row.member_sub,
    name: row.display_name,
    rankCode: row.rank_code,
    role: row.role,
    roles: d?.roles ?? [],
    hglobal: d?.hglobal ?? false,
    center: d?.center ? { key: centerKey(d.center), label: d.center } : null,
  };
}

export async function ranks(db: D1Database): Promise<Map<string, Rank>> {
  const { results } = await db.prepare("SELECT code, name, sort_order FROM ranks ORDER BY sort_order").all<{
    code: string;
    name: string;
    sort_order: number;
  }>();
  return new Map(results.map((r) => [r.code, { code: r.code, name: r.name, order: r.sort_order }]));
}

export const ROLE_TITLES: Record<string, string> = { super_admin: "超級管理員", secretary: "總部秘書", president: "會長", sound: "音控", course: "課務", reviewer: "審核員" };
/** 對外顯示的獎銜：會員中心獎銜為「無」（或沒填）時顯示「安麗寶寶」；其餘用獎銜階梯的名稱。 */
export function rankLabelOf(v: string | null, rankMap: Map<string, Rank>): string {
  if (!v || v === "none" || v === "無") return "安麗寶寶";
  return rankMap.get(v)?.name ?? v;
}
export function memberOf(s: Session, rankMap: Map<string, Rank>, extra: { duties?: string[] } = {}): Member {
  const titles = [...s.roles.map((r) => ROLE_TITLES[r]).filter(Boolean), ...(extra.duties ?? [])];
  const base = { sub: s.sub, name: s.name, role: s.role, titles: [...new Set(titles)], reviewer: s.role === "admin" || s.roles.includes("president") || !!extra.duties?.length, center: s.center?.label ?? null };
  // 中央會員的獎銜屬 Amway 資料，App 不取得也不顯示；只有模擬會員帶示範獎銜。
  if (s.kind === "central") return { ...base, rank: null, demo: false, avatarUrl: s.avatarUrl, rankLabel: s.rankLabel ?? (s.rankValue === undefined ? null : rankLabelOf(s.rankValue, rankMap)), rankBadge: null };
  return { ...base, rank: rankMap.get(s.rankCode) ?? null, demo: true, rankBadge: null };
}

/** 各最低獎銜是否符合：模擬會員比對示範獎銜；中央會員向中央查詢（fail closed）。 */
export async function eligibilityFor(session: Session | null, rankMap: Map<string, Rank>, codes: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (!session) return out;
  if (session.kind === "central") return rankEligibility(session.sub, session.token, codes);
  const mine = rankMap.get(session.rankCode)?.order ?? -1;
  for (const c of codes) out.set(c, c === "none" || mine >= (rankMap.get(c)?.order ?? Infinity));
  return out;
}

export function audit(db: D1Database, actor: string, action: string, type: string, id: string, detail = ""): D1PreparedStatement {
  return db
    .prepare("INSERT INTO audit_log (id, actor_sub, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), actor, action, type, id, detail);
}

export function notify(db: D1Database, to: { sub: string } | { role: "admin" } | { role: "president"; centerKey: string }, title: string, body: string, link: string): D1PreparedStatement {
  return db
    .prepare("INSERT INTO notifications (id, recipient_sub, recipient_role, recipient_center_key, title, body, link) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), "sub" in to ? to.sub : null, "role" in to ? to.role : null, "centerKey" in to ? to.centerKey : null, title, body, link);
}

/** 通知分類（杜杜龍 2026-11-17）：留言、訂閱（中心／系列有新課程、章節、教材、公告）、審核（報名審核與結果、審核人員指派），其餘＝其他（只在「全部」看到）。 */
export function noticeCategory(title: string, link: string): NoticeCategory {
  if (/獲得學習徽章/.test(title)) return "achievement";
  if (/留言|回覆/.test(title)) return "comment";
  if (/有新(課程|清單|章節|教材)|廣播公告|已送出「新/.test(title)) return "subscribe";
  if (/審核|等待|報名已|課程已開通|繳費確認|開通已撤銷|報名有|邀請碼|已成為課程報名|^你的.{1,6}申請|^已送出.{1,6}申請/.test(title) || link.startsWith("/admin/orders")) return "review";
  return "other";
}

/**
 * 中央的獎銜／中心申請有結果時，通知申請人（站內通知＋手機推播；杜杜龍 2026-11-19 回報申請人沒收到通知）。
 * 中央自己的「已通知會員」只在會員中心，不會到行動大學，所以行動大學要自己發。兩個來源（審核回應、webhook）可能重複，2 分鐘內同一人只發一則。
 */
export async function notifyReviewResult(db: D1Database, sub: string, what: string): Promise<void> {
  const title = `你的${what}申請有結果了`;
  const dup = await db.prepare("SELECT 1 AS x FROM notifications WHERE recipient_sub = ? AND title LIKE '你的%申請有結果了' AND created_at > ?").bind(sub, new Date(Date.now() - 120_000).toISOString()).first();
  if (dup) return;
  await notify(db, { sub }, title, "到「設定」頁看最新的獎銜與中心資料", "/settings").run();
}
/** 申請內容轉成文字（中央的值可能是字串或 {option, custom_text}）。 */
export const reviewText = (v: unknown): string => (v == null || v === "" ? "" : typeof v === "string" ? v : typeof v === "object" && "option" in (v as object) ? String((v as { option: unknown }).option ?? "") : String(v)).slice(0, 80);
export const REVIEW_FIELD_LABEL: Record<string, string> = { rank: "獎銜", education_center: "中心", education_system: "系統" };

/** 杜杜龍本人（管理員帳號或超級管理員）；使用統計用來排除本人的操作。 */
export const isOwnerSession = (s: Session | null): boolean => !!s && (s.role === "admin" || s.roles.includes("super_admin"));

/** 統計分析：超級管理員、總部秘書一定可以；其他職務要被超級管理員指定。 */
export async function canViewStats(ctx: Ctx, s: Session): Promise<boolean> {
  if (s.role === "admin") return true;
  if (!s.roles.length) return false;
  const cfg = await loadConfig(ctx.db);
  return s.roles.some((r) => cfg.statsRoles.includes(r));
}

/** 重新計算會員的徽章；新取得的發站內通知，回傳完整清單。 */
export async function grantAchievements(ctx: Ctx, sub: string) {
  const { list, fresh } = await evaluateAchievements(ctx.db, sub);
  if (fresh.length) await ctx.db.batch(fresh.map((a) => notify(ctx.db, { sub }, "獲得學習徽章", `${iconText(a.icon)} ${a.name}：${a.description}`, "/achievements")));
  return list;
}

export const ACH_TYPES = Object.keys(ACHIEVEMENT_TYPES) as AchievementType[];
export async function achievementBody(ctx: Ctx, body: Record<string, unknown>, creating: boolean) {
  const sets: [string, unknown][] = [];
  const name = text(body.name, 30);
  if (name !== undefined) {
    if (!name) fail(400, "name_required", "請輸入徽章名稱");
    sets.push(["name", name]);
  } else if (creating) fail(400, "name_required", "請輸入徽章名稱");
  const desc = text(body.description, 100);
  if (desc !== undefined) sets.push(["description", desc]);
  const icon = text(body.icon, 8);
  if (icon !== undefined) sets.push(["icon", icon || "🏅"]);
  if (creating && body.type === "material_video") fail(400, "auto_only", "清單影片徽章由系統抽選產生，請在「清單影片」分類按「重新抽選」");
  if (body.type !== undefined || creating) {
    if (typeof body.type !== "string" || !ACH_TYPES.includes(body.type as AchievementType)) fail(400, "invalid_type", "條件類型不正確");
    sets.push(["condition_type", body.type]);
  }
  if (body.threshold !== undefined || creating) {
    const n = Number(body.threshold ?? 1);
    if (!Number.isInteger(n) || n < 1 || n > 100000) fail(400, "invalid_threshold", "達成數量請輸入 1 以上的整數");
    sets.push(["threshold", n]);
  }
  if (body.unit !== undefined) {
    if (body.unit === null || body.unit === "") sets.push(["unit", null]);
    else if (typeof body.unit === "string" && (ACH_UNITS as readonly string[]).includes(body.unit)) sets.push(["unit", body.unit]);
    else fail(400, "invalid_unit", "單位不正確");
  }
  if (body.courseId !== undefined) {
    if (body.courseId === null || body.courseId === "") sets.push(["course_id", null]);
    else {
      if (!(await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").bind(String(body.courseId)).first())) fail(400, "invalid_course", "找不到這門課程");
      sets.push(["course_id", body.courseId]);
    }
  }
  if (body.lessonId !== undefined && body.type !== "material_video") {
    if (body.lessonId === null || body.lessonId === "") sets.push(["lesson_id", null]);
    else {
      if (!(await ctx.db.prepare("SELECT 1 AS ok FROM lessons WHERE id = ?").bind(String(body.lessonId)).first())) fail(400, "invalid_lesson", "找不到這個教材");
      sets.push(["lesson_id", body.lessonId]);
    }
  }
  if (body.series !== undefined) {
    if (body.series === null || body.series === "") sets.push(["series", null]);
    else {
      if (!(await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE series = ? LIMIT 1").bind(String(body.series)).first())) fail(400, "invalid_series", "找不到這個系列卡");
      sets.push(["series", body.series]);
    }
  }
  if (creating) {
    const has = (c: string) => sets.some(([k, v]) => k === c && !!v);
    if (body.type === "target_lesson" && !has("lesson_id")) fail(400, "target_required", "請搜尋並指定一個教材");
    if (body.type === "course_completed" && !has("course_id")) fail(400, "target_required", "請搜尋並指定一張課程卡");
    if (body.type === "series_completed" && !has("series")) fail(400, "target_required", "請搜尋並指定一張系列卡");
  }
  if (body.feature !== undefined) {
    if (body.feature === null || body.feature === "") sets.push(["feature", null]);
    else if (typeof body.feature === "string" && body.feature in FEATURES) sets.push(["feature", body.feature]);
    else fail(400, "invalid_feature", "功能代碼不正確");
  }
  if (sets.some(([c, v]) => c === "condition_type" && v === "feature_used") && !sets.some(([c, v]) => c === "feature" && typeof v === "string")) fail(400, "feature_required", "請選擇要使用的功能");
  if (body.difficulty !== undefined) {
    const d = Number(body.difficulty);
    if (!Number.isInteger(d) || d < 1 || d > 3) fail(400, "invalid_difficulty", "難易度請選 1～3 顆星");
    sets.push(["difficulty", d]);
  }
  if (body.active !== undefined) sets.push(["active", body.active === true ? 1 : 0]);
  return sets;
}
export async function listAchievements(ctx: Ctx): Promise<AdminAchievement[]> {
  // 會員總數＝有任何學習、報名、訂閱、功能使用或徽章紀錄的不同會員（本系統沒有獨立的會員名冊）。
  // （D1 一個查詢最多接 5 個 UNION，所以分開查再合併。）
  const subs = new Set<string>();
  const parts = await ctx.db.batch(["member_achievements", "feature_uses", "enrollments", "lesson_progress", "learning_started", "center_subscriptions"].map((t) => ctx.db.prepare(`SELECT DISTINCT member_sub FROM ${t}`)));
  for (const r of parts) for (const x of r.results as { member_sub: string }[]) subs.add(x.member_sub);
  const total = subs.size;
  const { results } = await ctx.db
    .prepare("SELECT a.id, a.name, a.description, a.icon, a.condition_type, a.threshold, a.course_id, a.feature, a.lesson_id, a.unit, a.series, a.difficulty, a.active, (SELECT title FROM courses WHERE id = a.course_id) AS course_title, (SELECT title FROM lessons WHERE id = a.lesson_id) AS lesson_title, (SELECT COUNT(*) FROM member_achievements m WHERE m.achievement_id = a.id) AS earned_count FROM achievements a ORDER BY a.sort_order, a.created_at")
    .all<{ difficulty: number; id: string; name: string; description: string; icon: string; condition_type: AchievementType; threshold: number; course_id: string | null; feature: string | null; lesson_id: string | null; unit: string | null; series: string | null; lesson_title: string | null; active: number; course_title: string | null; earned_count: number }>();
  return results.map((r) => ({ id: r.id, name: r.name, description: r.description, icon: r.icon, type: r.condition_type, threshold: r.threshold, courseId: r.course_id, feature: r.feature, unit: r.unit, series: r.series, lessonId: r.lesson_id, lessonTitle: r.lesson_title, courseTitle: r.course_title, active: r.active === 1, earnedCount: r.earned_count, difficulty: (r.difficulty >= 1 && r.difficulty <= 3 ? r.difficulty : 2) as 1 | 2 | 3, memberTotal: total }));
}

/** 刪除一位會員在本 App 的所有資料。 */
export async function purgeMember(db: D1Database, sub: string, actor: string, action: string): Promise<void> {
  await db.prepare("DELETE FROM push_subscriptions WHERE member_sub = ?").bind(sub).run();
  await db.batch([
    db.prepare("DELETE FROM course_comments WHERE member_sub = ?").bind(sub),
    db.prepare("DELETE FROM comment_blocks WHERE member_sub = ? OR blocked_sub = ?").bind(sub, sub),
    db.prepare("DELETE FROM comment_reports WHERE reporter_sub = ?").bind(sub),
    db.prepare("DELETE FROM lesson_progress WHERE member_sub = ?").bind(sub),
    db.prepare("DELETE FROM learning_started WHERE member_sub = ?").bind(sub),
    db.prepare("DELETE FROM feature_uses WHERE member_sub = ?").bind(sub),
    db.prepare("DELETE FROM center_views WHERE member_sub = ?").bind(sub),
    db.prepare("DELETE FROM series_views WHERE member_sub = ?").bind(sub),
    db.prepare("DELETE FROM lesson_watch WHERE member_sub = ?").bind(sub),
    db.prepare("DELETE FROM enrollments WHERE member_sub = ?").bind(sub),
    // 審核員／窗口收到的「有新的報名待審核」等通知連到這位會員的報名紀錄，報名紀錄刪除前先清掉，免得點了找不到。
    db.prepare("DELETE FROM notifications WHERE (link LIKE '/admin/orders/%' AND substr(link, 15) IN (SELECT id FROM orders WHERE member_sub = ?1)) OR (link LIKE '/orders/%' AND substr(link, 9) IN (SELECT id FROM orders WHERE member_sub = ?1))").bind(sub),
    db.prepare("DELETE FROM orders WHERE member_sub = ?").bind(sub),
    db.prepare("DELETE FROM notifications WHERE recipient_sub = ?").bind(sub),
    db.prepare("DELETE FROM member_achievements WHERE member_sub = ?").bind(sub),
    db.prepare("DELETE FROM member_contacts WHERE member_sub = ?").bind(sub),
    // 審核紀錄（中央串接指令 2026-11-22.4 三、16）：待審的直接刪；已處理的只清掉姓名與申請內容快照，整筆紀錄（結果、時間、審核者）保留。
    db.prepare("DELETE FROM review_log WHERE applicant_sub = ? AND status = 'pending'").bind(sub),
    db.prepare("UPDATE review_log SET applicant_name = '', from_text = '', to_text = '', final_text = '' WHERE applicant_sub = ?").bind(sub),
    db.prepare("DELETE FROM sessions WHERE member_sub = ?").bind(sub),
    audit(db, actor, action, "member", sub),
  ]);
  forgetMember(sub);
}
