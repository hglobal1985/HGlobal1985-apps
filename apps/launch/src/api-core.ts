/**
 * 行動大學 API 的共用核心（杜杜龍 2026-11-27 從 api.ts 拆出）：型別、共用函式、權限檢查、資料讀寫輔助。
 * 各功能的網址處理在 routes/*.ts，總路由表與 handleApi 在 api.ts。新增共用函式放這裡並 export。
 */
import { kickFilePhotos } from "./block-photos.ts";
import { treasureCourseId } from "./treasure-box.ts";
import { HQ_SLUG } from "./short-links.ts";
import { romanizeName, romanizeTitle } from "./romanize.ts";
import {
  DEMO_MEMBERS,
  HQ_UNIT,
  REVIEW_REASONS,
  ACHIEVEMENT_TYPES,
  ACH_UNITS,
  UNCATEGORIZED,
  textCoverLines,
  iconText,
  applicantLabel,
  type InviteInfo,
  SERIES_APPLY_FIELDS,
  SERIES_PRICE_FIELDS,
  type SeriesApplyPlan,
  type SeriesApplyResult,
  type SeriesRosterPlan,
  type Roster,
  type RosterRow,
  type AchievementType,
  type AdminAchievement,
  type CourseComment,
  type Duty,
  type OrderEvent,
  type ReviewAction,
  type ReviewGroup,
  type ReviewReason,
  type ClientPlatform,
  type CourseDetail,
  type CourseSummary,
  type CourseCan,
  type CourseEditor,
  type CenterArt,
  type ThumbBadge,
  type ThumbBadgeKind,
  type ThumbBadgeRow,
  THUMB_BADGE_KINDS,
  type SeriesArt,
  type SeriesSetting,
  type EditorCandidate,
  type Member,
  type AttachmentType,
  type Announcement,
  type CourseDeleteImpact,
  type Notice,
  type NoticeCategory,
  type CentralReviews,
  type LibraryItem,
  type LibraryMine,
  type BrandCover,
  type BrandLogo,
  NOTICE_KINDS,
  type NoticeKind,
  LIBRARY_KEY_BADGES,
  FEATURES,
  type LibraryView,
  type LibraryUnlock,
  type NotificationSettings,
  type Order,
  type PaymentMethodKey,
  type PaymentReport,
  type Rank,
  REVIEW_ROLES,
  type ReviewDesk,
  type ReviewRole,
  type RegistrationReport,
  type ReportBy,
  type ReportRow,
  VIEW_SCOPES,
  type ViewScope,
  ZONES,
  zoneOf,
  type ThumbSettings,
  THUMB_WIDE_WIDTHS,
  type CoverMediaKind,
  type CoverScope,
  type CoverMediaItem,
  type AlbumFolder,
  type AlbumInfo,
  type AlbumSubfolders,
  type AlbumPermissions,
  type AlbumsResponse,
  LIST_COVER_COLORS,
  UPGRADING_MSG,
} from "./contract.ts";
import { checkPasswordInput, expiresAt, hashPassword, libraryNumber, pwActive } from "./library.ts";
import { recipePrefixes, recipeIdOfKey } from "./recipes.ts";
import { recipeShortPath, type RecipeDetail } from "./contract.ts";
import { ListError, quotaOf } from "./my-lists.ts";
import { lastUplineError, lookupUplines, memberNumberOf, centralAddJobTitle, amwayMe, centerKey, centerList, rankOptionList, centralSuggest, contactEmail, forgetMember, legalNameOf, profileSummary, reportIntegration, isAdmin, looksLikeJwt, memberContext, rankEligibility, verifyAccessToken } from "./central.ts";
import type { D1Database, D1PreparedStatement, Env } from "./d1.ts";
import { LINK_DEFAULT_TITLE, classifyLink, parseHttpsUrl } from "./links.ts";
import { itemIconType } from "./link-rules.ts";
import { fetchLinkTitle } from "./link-title.ts";
import { evaluateAchievements } from "./achievements.ts";
import { cleanOcrText, fmtOf, loadFields, structureEdm, type Structured } from "./edm-structure.ts";
import { AI_JOBS, AI_MODELS, keyStatuses, loadSelection, loadSettings as loadAiSettings, todayUsed as aiTodayUsed, usageSummary } from "./ai-models.ts";
import { loadConfig } from "./ui-config.ts";
import { imageSize } from "./image-size.ts";

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

// ---------- courses ----------

export type CourseRow = {
  id: string;
  title: string;
  subtitle: string;
  teacher: string;
  teacher_rank: string;
  teacher_title: string;
  no_speaker: number;
  is_package: number;
  category: string;
  price_twd: number;
  min_rank_code: string;
  theme: string;
  status: "draft" | "published" | "archived";
  description?: string;
  guidance_unit: string;
  host_unit: string;
  host_center_key: string | null;
  is_shorts: number;
  is_list: number;
  chapter_n: number;
  url_name: string | null;
  mat_url: string | null;
  free_from: string | null;
  free_until: string | null;
  review_group_id: string | null;
  allow_president: number;
  invite_only: number;
  invite_code: string;
  event_start: string | null;
  event_end: string | null;
  is_public: number;
  view_scope: string;
  price_tba: number;
  hide_home: number;
  brand_id: string | null;
  zone: string;
  series_order: number;
  series_hidden: number;
  diamond_free: number;
  series: string;
  series_edm_key: string | null;
  series_art_version: number | null;
  series_cover_key: string | null;
  early_bird: number;
  early_price_twd: number | null;
  early_until: string | null;
  location: string;
  location_none: number;
  is_online: number;
  chapter_covers: number;
  block_photos: number;
  auto_cover: number;
  center_course: number;
  created_at: string;
  cover_key: string | null;
  edm_view_y: number;
  cover_rect: string | null;
  edm_key: string | null;
  art_version: number;
  created_by_sub: string;
  edited_by_name: string;
  edited_at: string | null;
  updated_at: string;
  lesson_count: number;
  total_minutes: number;
  zero_minute_lessons: number;
  material_count: number;
};

/**
 * 「純教材」判斷（杜杜龍 2026-11-20：教材卡只剩一種）：舊的清單型卡片（is_list=1），或是「沒有章節、免費、沒有日期」的教材卡。
 * 純教材卡沿用清單的規則：不需要報名、不顯示緞帶與費用、不列入學習中；一加上章節、日期或費用，就自動變成一般課程的規則。
 */
export const materialLike = (r: { invite_only: number; is_list: number; chapter_n: number; price_twd: number; price_tba: number; event_start: string | null; event_end: string | null }): boolean =>
  r.invite_only !== 1 && (r.is_list === 1 || (r.chapter_n === 0 && r.price_twd === 0 && r.price_tba !== 1 && !r.event_start && !r.event_end)); // 指定邀請制一定是要報名的一般課程（杜杜龍 2026-11-20）
/** 同一個判斷的 SQL 版（FROM courses 的查詢用）。 */
export const MATERIAL_LIKE_SQL = `(invite_only = 0 AND (is_list = 1 OR (NOT EXISTS (SELECT 1 FROM lessons ch WHERE ch.course_id = courses.id AND ch.kind = 'chapter') AND price_twd = 0 AND price_tba <> 1 AND COALESCE(event_start, '') = '' AND COALESCE(event_end, '') = '')))`;

export const COURSE_SELECT = `SELECT c.view_scope, c.id, c.title, c.subtitle, c.teacher, c.teacher_rank, c.teacher_title, c.no_speaker, c.is_package, c.category, c.price_twd, c.min_rank_code, c.theme, c.status, c.description, c.guidance_unit, c.host_unit, c.host_center_key, c.is_shorts, c.is_list, (SELECT COUNT(*) FROM lessons ch WHERE ch.course_id = c.id AND ch.kind = 'chapter') AS chapter_n, c.url_name, c.mat_url, c.free_from, c.free_until, c.review_group_id, c.allow_president, c.invite_only, c.invite_code, c.event_start, c.event_end, c.is_public, c.price_tba, c.hide_home, c.brand_id, c.zone, c.diamond_free, c.series, c.series_order, c.series_hidden, (SELECT a.edm_key FROM series_art a WHERE a.series = c.series AND c.series <> '') AS series_edm_key, (SELECT a.art_version FROM series_art a WHERE a.series = c.series AND c.series <> '') AS series_art_version, (SELECT a.cover_key FROM series_art a WHERE a.series = c.series AND c.series <> '') AS series_cover_key, c.early_bird, c.early_price_twd, c.early_until, c.location, c.location_none, c.is_online, c.chapter_covers, c.block_photos, c.auto_cover, c.center_course, c.edm_key, c.cover_key, c.edm_view_y, c.cover_rect, c.art_version, c.created_by_sub, c.edited_by_name, c.edited_at, c.updated_at, c.created_at,
  (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id AND (l.kind = 'chapter' OR (l.kind = 'material' AND l.is_full = 0 AND l.media_ref IS NOT NULL AND l.media_type <> 'demo' AND l.course_id IN (SELECT id FROM courses WHERE is_list = 1)))) AS lesson_count,
  (SELECT COALESCE(SUM(duration_minutes), 0) FROM lessons l WHERE l.course_id = c.id AND (l.kind = 'chapter' OR (l.kind = 'material' AND l.is_full = 0 AND l.media_ref IS NOT NULL AND l.media_type <> 'demo' AND l.course_id IN (SELECT id FROM courses WHERE is_list = 1)))) AS total_minutes,
  (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id AND (l.kind = 'chapter' OR (l.kind = 'material' AND l.is_full = 0 AND l.media_ref IS NOT NULL AND l.media_type <> 'demo' AND l.course_id IN (SELECT id FROM courses WHERE is_list = 1))) AND l.duration_minutes = 0) AS zero_minute_lessons,
  (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id AND ((l.media_type <> 'demo' AND l.media_ref IS NOT NULL) OR EXISTS (SELECT 1 FROM lesson_attachments a WHERE a.lesson_id = l.id))) + (SELECT COUNT(*) FROM cover_media pm WHERE pm.owner_kind = 'course' AND pm.scope = 'cover' AND pm.owner_key IN (SELECT id FROM lessons WHERE course_id = c.id AND kind = 'section')) AS material_count
  FROM courses c`;

export async function memberCourseState(db: D1Database, sub: string | undefined) {
  const empty = { lastLearned: new Map<string, string>(), partialMinutes: new Map<string, number>(), partialLessons: new Map<string, number>(), started: new Set<string>(), startedHidden: new Set<string>(), hidden: new Set<string>(), enrolled: new Set<string>(), pending: new Set<string>(), pendingOrder: new Map<string, string>(), done: new Map<string, number>(), doneMinutes: new Map<string, number>() };
  if (!sub) return empty;
  const [e, p, d, st, w, last] = await db.batch([
    db.prepare("SELECT course_id, hidden FROM enrollments WHERE member_sub = ?").bind(sub),
    db.prepare("SELECT i.course_id, i.order_id FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.member_sub = ? AND o.status = 'pending' ORDER BY o.created_at").bind(sub),
    db.prepare("SELECT p.course_id AS course_id, COUNT(*) AS n, COALESCE(SUM(l.duration_minutes), 0) AS m FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id AND l.kind = 'chapter' WHERE p.member_sub = ? GROUP BY p.course_id").bind(sub),
    db.prepare("SELECT course_id, hidden FROM learning_started WHERE member_sub = ?").bind(sub),
    // 還沒看完的章節：播放到哪（比例）× 該章長度，讓進度條隨播放前進。
    db.prepare("SELECT w.course_id AS course_id, SUM(w.ratio * l.duration_minutes) AS m, SUM(w.ratio) AS n FROM lesson_watch w JOIN lessons l ON l.id = w.lesson_id AND l.kind = 'chapter' LEFT JOIN lesson_progress p ON p.lesson_id = w.lesson_id AND p.member_sub = w.member_sub WHERE w.member_sub = ? AND p.lesson_id IS NULL GROUP BY w.course_id").bind(sub),
    // 最近一次學習時間：播放紀錄、完成章節、開始學習三者取最新。
    db.prepare("SELECT course_id, MAX(t) AS t FROM (SELECT course_id, updated_at AS t FROM lesson_watch WHERE member_sub = ? UNION ALL SELECT course_id, completed_at FROM lesson_progress WHERE member_sub = ? UNION ALL SELECT course_id, created_at FROM learning_started WHERE member_sub = ?) GROUP BY course_id").bind(sub, sub, sub),
  ]);
  const keys = (rows: unknown[]) => new Set((rows as { course_id: string }[]).map((r) => r.course_id));
  const pendingOrder = new Map<string, string>();
  for (const r of p.results as { course_id: string; order_id: string }[]) pendingOrder.set(r.course_id, r.order_id);
  const hidden = new Set((e.results as { course_id: string; hidden: number }[]).filter((r) => r.hidden === 1).map((r) => r.course_id));
  const startedRows = st.results as { course_id: string; hidden: number }[];
  const partial = w.results as { course_id: string; m: number; n: number }[];
  return { lastLearned: new Map((last.results as { course_id: string; t: string }[]).map((r) => [r.course_id, r.t])), partialMinutes: new Map(partial.map((r) => [r.course_id, r.m])), partialLessons: new Map(partial.map((r) => [r.course_id, r.n])), started: new Set(startedRows.map((r) => r.course_id)), startedHidden: new Set(startedRows.filter((r) => r.hidden === 1).map((r) => r.course_id)), hidden, enrolled: keys(e.results), pending: keys(p.results), pendingOrder, done: new Map((d.results as { course_id: string; n: number }[]).map((r) => [r.course_id, r.n])), doneMinutes: new Map((d.results as { course_id: string; m: number }[]).map((r) => [r.course_id, r.m])) };
}
export type MemberState = Awaited<ReturnType<typeof memberCourseState>>;
/**
 * 已報名／審核中／學習過的人，在「誰能瀏覽」改嚴之後是否仍保有存取（杜杜龍 2026-11-18）：
 * 付費課程的報名是繳費換來的，照常保留；免費課程的報名與「學習過」都是第一次打開時自動完成的，不算資格，要照現在的瀏覽範圍。
 */
export function keepsAccess(state: MemberState, r: { id: string; price_twd: number; price_tba: number }): boolean {
  if (r.price_twd === 0 && r.price_tba !== 1) return false;
  return state.enrolled.has(r.id) || state.pending.has(r.id) || state.started.has(r.id);
}

/** 早鳥優惠是否有效：台灣時間 early_until（含當天）之前。 */
export const earlyActive = (row: { early_bird: number; early_price_twd: number | null; early_until: string | null; price_twd: number }, now = iso()) =>
  row.early_bird === 1 && row.early_price_twd != null && row.early_price_twd < row.price_twd && !!row.early_until && new Date(Date.parse(now) + 8 * 3600_000).toISOString().slice(0, 10) <= row.early_until;

/** 「鑽石免費」判斷用的獎銜代碼：鑽石（含）以上。 */
export const DIAMOND = "diamond";

/** 「會長也可報名」：課程開啟此條件時，會長不受獎銜限制。 */
export const byPresident = (s: Session | null, c: { allow_president: number }) => c.allow_president === 1 && !!s?.roles.includes("president");

export const inFreeWindow = (row: { free_from: string | null; free_until: string | null }, now = iso()) =>
  !!(row.free_from || row.free_until) && (!row.free_from || row.free_from <= now) && (!row.free_until || now < row.free_until);

/** 課程的 EDM／封面網址（只有手動上傳的；沒有就由畫面用課程標題產生文字封面，不再用 YouTube 縮圖，杜杜龍 2026-11-22）。 */
export function courseArt(row: CourseRow) {
  return {
    edmUrl: row.edm_key ? pubUrl(row.edm_key, row.art_version) : null,
    coverUrl: row.cover_key ? pubUrl(row.cover_key, row.art_version) : null,
    edmViewY: row.edm_view_y,
    coverRect: parseCoverRect(row.cover_rect),
  };
}

export function summarize(row: CourseRow, ctx: Ctx, rankMap: Map<string, Rank>, state: MemberState, eligibility: Map<string, boolean>): CourseSummary {
  const minRank = rankMap.get(row.min_rank_code) ?? { code: row.min_rank_code, name: row.min_rank_code, order: 9999 };
  const freeNow = row.price_twd > 0 && inFreeWindow(row);
  const diamondNow = row.diamond_free === 1 && row.price_twd > 0 && eligibility.get(DIAMOND) === true;
  const earlyNow = earlyActive(row);
  const price = freeNow || diamondNow ? 0 : earlyNow ? (row.early_price_twd as number) : row.price_twd;
  const web = ctx.platform === "web";
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    teacher: row.teacher,
    teacherRank: row.teacher_rank,
    teacherRankName: rankMap.get(row.teacher_rank)?.name ?? "",
    teacherTitle: row.teacher_title,
    noSpeaker: row.no_speaker === 1,
    isPackage: row.is_package === 1,
    category: row.category,
    priceTwd: web ? price : null,
    originalPriceTwd: web ? row.price_twd : null,
    free: price === 0 && row.price_tba !== 1,
    paid: row.price_twd > 0, // 付費課程（原價大於 0；限時免費、早鳥、鑽石免費仍算付費課程）
    freeNow,
    freeUntil: freeNow ? row.free_until : null,
    minRank,
    theme: row.theme,
    ...courseArt(row),
    // 中心課程＝主辦單位含某個中心（自動，不再手動勾選）；只有總部主辦的是一般課程。
    centerCourse: row.host_center_key != null,
    isShorts: row.is_shorts === 1,
    isList: materialLike(row),
    // 素材（清單）有第二層網址且系列有短網址：/系列縮寫/素材名稱；否則沿用原本的課程專屬網址。
    shortPath: row.is_list === 1 && row.mat_url && row.series && ctx.seriesSlugs?.get(row.series) ? `${ctx.seriesSlugs.get(row.series)}/${row.mat_url}` : row.url_name ? (row.host_center_key ? (ctx.centerSlugs?.get(row.host_center_key) ? `${ctx.centerSlugs.get(row.host_center_key)}/${row.url_name}` : null) : `${HQ_SLUG}/${row.url_name}`) : null,
    matUrl: row.mat_url,
    createdAt: row.created_at,
    hostCenter: hostCenterOf(row.host_unit),
    hostCenterKey: row.host_center_key,
    status: row.status,
    guidanceUnit: row.guidance_unit,
    hostUnit: row.host_unit,
    eventStart: row.event_start,
    eventEnd: row.event_end,
    isPublic: row.is_public === 1 && row.invite_only !== 1, // 指定邀請制不可能完全公開
    viewScope: scopeOf(row.view_scope),
    pendingOrderId: state.pendingOrder.get(row.id) ?? null,
    priceTba: row.price_tba === 1,
    hideFromHome: row.hide_home === 1,
    seriesOrder: row.series_order,
    seriesHidden: row.series_hidden === 1,
    zone: zoneOf(row.zone, row.is_list === 1),
    brandId: row.brand_id,
    brandName: ctx.brands?.find((x) => x.id === row.brand_id)?.name ?? null,
    brand: brandFor(ctx, row),
    blocks: ctx.blocks?.get(row.id) ?? [],
    series: row.series,
    seriesEdmUrl: row.series_edm_key ? pubUrl(row.series_edm_key, row.series_art_version ?? 1) : null,
    seriesCoverUrl: row.series_cover_key ? pubUrl(row.series_cover_key, row.series_art_version ?? 1) : null,
    // 學習中：有報名的看報名紀錄的隱藏；沒報名但播放過的（例如管理員、公開課程）看播放紀錄的隱藏。
    hiddenFromLearning: state.enrolled.has(row.id) ? state.hidden.has(row.id) : state.startedHidden.has(row.id),
    lastLearnedAt: state.lastLearned.get(row.id) ?? null,
    started: state.started.has(row.id) || (state.done.get(row.id) ?? 0) > 0,
    // 只有清單／素材類「符合獎銜就能直接使用」；課程類一律要手動報名（杜杜龍 2026-11-18）。
    watchFree: !!ctx.session && materialLike(row) && row.status === "published" && row.price_twd === 0 && row.price_tba !== 1 && (eligibility.get(row.min_rank_code) === true || byPresident(ctx.session, row)),
    diamondFree: row.diamond_free === 1,
    diamondFreeNow: diamondNow,
    earlyBird: row.early_bird === 1 && row.early_price_twd != null && !!row.early_until ? { priceTwd: web ? row.early_price_twd : null, until: row.early_until, active: earlyNow } : null,
    location: row.location,
    locationNone: row.location_none === 1,
    isOnline: row.is_online === 1,
    chapterCovers: row.chapter_covers === 1,
    blockPhotos: row.block_photos === 1,
    lessonCount: row.lesson_count,
    hasMaterial: row.material_count > 0,
    // 教材數：自己的教材，加上連結區塊（品牌資訊卡的「新品特惠培訓直播」）來源清單裡的教材。
    materialCount: row.material_count + (materialLike(row) ? (ctx.blocks?.get(row.id) ?? []).reduce((n, b) => n + (b.linked ? b.count : 0), 0) : 0),
    totalMinutes: row.total_minutes,
    eligible: row.invite_only === 1 || eligibility.get(row.min_rank_code) === true || byPresident(ctx.session, row), // 指定邀請制不看獎銜
    allowPresident: row.allow_president === 1,
    inviteOnly: row.invite_only === 1,
    inviteHasCode: row.invite_only === 1 && row.invite_code !== "",
    canRoster: false, // 課程頁（courseDetail）再依登入者的權限補上
    enrollment: state.enrolled.has(row.id) ? "opened" : state.pending.has(row.id) ? "pending" : null,
    completedLessons: state.done.get(row.id) ?? 0,
    // 學習進度百分比：每一堂都有長度就以「（已完成的長度＋沒看完章節已播放的部分）／總長度」算；有任何一堂沒有長度（例如 YouTube 抓不到時間），改用章節數（已完成章節數＋沒看完章節的播放比例）／章節總數。
    progressPercent:
      row.lesson_count === 0
        ? 0
        : Math.min(
            100,
            Math.round(
              row.zero_minute_lessons === 0 && row.total_minutes > 0
                ? (((state.doneMinutes.get(row.id) ?? 0) + (state.partialMinutes.get(row.id) ?? 0)) / row.total_minutes) * 100
                : (((state.done.get(row.id) ?? 0) + (state.partialLessons.get(row.id) ?? 0)) / row.lesson_count) * 100,
            ),
          ),
  };
}

export const scopeOf = (v: string): ViewScope => (VIEW_SCOPES as string[]).includes(v) ? (v as ViewScope) : "all";
/** 私密連結：不顯示在任何清單與搜尋，只有拿到網址的人能開。 */
export const isPrivate = (scope: string) => scope === "link_login" || scope === "link_guest";
/** 誰可以瀏覽（杜杜龍 2026-11-17）：這位使用者依課程的設定看不看得到。 */
export function scopeAllows(scope: string, s: Session | null): boolean {
  if (scope === "members" || scope === "link_login") return !!s;
  if (scope === "hglobal") return !!s?.hglobal;
  if (scope === "center") return !!s?.center;
  return true;
}

export async function listCourses(ctx: Ctx, all: boolean): Promise<CourseSummary[]> {
  const s = ctx.session;
  let where = " WHERE c.status = 'published'";
  let args: unknown[] = [];
  let rights: Rights | null = null;
  if (all) {
    // 管理清單：總部看全部；會長、音控、小編只看主辦單位是自己中心的課程（含未上架、已封存）。
    rights = await rightsOf(ctx);
    if (!rights.any) fail(403, "forbidden", "需要課程管理權限");
    if (rights.admin) where = "";
    else {
      const keys = [...rights.centerKeys];
      where = keys.length ? ` WHERE c.host_center_key IN (${keys.map(() => "?").join(",")})` : " WHERE 0";
      args = keys;
    }
  } else if (s) {
    // 公開清單：已上架的課程；另外附上這位會員有報名、審核中或學習過的「下架封存」課程（學習中照常顯示，全部課程不顯示）。
    where = " WHERE c.status = 'published' OR (c.status = 'archived' AND (c.id IN (SELECT course_id FROM enrollments WHERE member_sub = ?1) OR c.id IN (SELECT i.course_id FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.member_sub = ?1 AND o.status = 'pending') OR c.id IN (SELECT course_id FROM learning_started WHERE member_sub = ?1)))";
    args = [s.sub];
  }
  // 全部同時查（以前網址對照表接在後面一個一個查，每一次都多等一趟資料庫來回）。
  const [{ results }, rankMap, state, centerSlugs, seriesSlugs, mine, brands, blocks] = await Promise.all([
    ctx.db.prepare(`${COURSE_SELECT}${where} ORDER BY c.sort_order, c.created_at`).bind(...args).all<CourseRow>(),
    ranks(ctx.db),
    memberCourseState(ctx.db, s?.sub),
    centerSlugMap(ctx.db),
    seriesSlugMap(ctx.db),
    !all && s ? rightsOf(ctx) : Promise.resolve(null),
    loadBrands(ctx.db), // 品牌與區塊也一起查（2026-11-21：以前排在後面，多等一趟資料庫來回）
    loadBlocks(ctx.db),
  ]);
  // 瀏覽範圍：管理清單不過濾；公開清單依「誰可以瀏覽」，管理者與已報名／審核中／學習過的人照常看得到。
  let visible = results;
  if (!all) {
    visible = results.filter((r) => {
      const mineOnly = state.enrolled.has(r.id) || state.pending.has(r.id) || state.started.has(r.id);
      if (isPrivate(r.view_scope)) return mineOnly; // 私密連結：不出現在任何清單（已報名／學習過的學員在「學習中」仍看得到）
      if (!s) return r.view_scope === "all";
      if (scopeAllows(r.view_scope, s) || mine?.admin) return true;
      return keepsAccess(state, r) || (mine?.any ? courseCan(mine, s, r).edit : false);
    });
  }
  const eligibility = await eligibilityFor(s, rankMap, [...visible.map((r) => r.min_rank_code), DIAMOND]);
  ctx.centerSlugs = centerSlugs;
  ctx.seriesSlugs = seriesSlugs;
  ctx.brands = brands;
  ctx.blocks = blocks;
  const out = visible.map((r) => summarize(r, ctx, rankMap, state, eligibility));
  if (!rights || !s) return out;
  const r = rights;
  return out.flatMap((c, i) => {
    const can = courseCan(r, s, visible[i]!);
    // 小編看不到「別人的、自己又不能動」的未上架課程。
    if (c.status !== "published" && !can.edit && !can.remove && !can.restore) return [];
    return [{ ...c, can }];
  });
}

// ---------- 課程管理權限：總部、該中心的會長與音控、小編 ----------

/** 小編的三種權限。 */
export type EditorFlags = { create: boolean; editOthers: boolean; deleteOthers: boolean };
export type Rights = {
  /** 有任何課程管理權限。 */
  any: boolean;
  /** 總部（超級管理員、總部秘書）。 */
  admin: boolean;
  /** 所屬中心的會長、音控。 */
  staff: boolean;
  /** 所屬中心的代碼（同時放會員中心給的 key 與本地正規化，兩種寫法都比對得到）。 */
  centerKeys: Set<string>;
  center: { key: string; label: string } | null;
  editor: EditorFlags | null;
};
export const NO_RIGHTS: Rights = { any: false, admin: false, staff: false, centerKeys: new Set(), center: null, editor: null };
export const rightsMemo = new WeakMap<Ctx, Promise<Rights>>();

/** 登入者的課程管理權限（同一個請求只查一次）。小編身分要「現在的中心」與被指派的中心相同才有效（換中心自動失效）。 */
export function rightsOf(ctx: Ctx): Promise<Rights> {
  const hit = rightsMemo.get(ctx);
  if (hit) return hit;
  const p = (async (): Promise<Rights> => {
    const s = ctx.session;
    if (!s) return NO_RIGHTS;
    const admin = s.role === "admin";
    const center = s.center;
    const centerKeys = new Set(center ? [center.key, centerKey(center.label)] : []);
    const staff = !!center && s.roles.some((r) => ART_TYPES.has(r));
    let editor: EditorFlags | null = null;
    if (center && !admin && !staff) {
      const keys = [...centerKeys];
      const row = await ctx.db
        .prepare(`SELECT can_create, can_edit_others, can_delete_others FROM course_editors WHERE member_sub = ? AND center_key IN (${keys.map(() => "?").join(",")}) LIMIT 1`)
        .bind(s.sub, ...keys)
        .first<{ can_create: number; can_edit_others: number; can_delete_others: number }>();
      if (row) editor = { create: row.can_create === 1, editOthers: row.can_edit_others === 1, deleteOthers: row.can_delete_others === 1 };
    }
    return { any: admin || staff || !!editor, admin, staff, centerKeys, center, editor };
  })();
  rightsMemo.set(ctx, p);
  return p;
}

export const canCreateCourse = (r: Rights) => r.admin || r.staff || !!r.editor?.create;

/** 對某門課能做什麼：總部全部；同中心的會長、音控全部；小編：自己新增的課程完整權限，別人的看「修改別人／刪除別人」。還原封存只有總部、會長、音控。 */
export function courseCan(r: Rights, s: Session, row: { host_center_key: string | null; created_by_sub: string }): CourseCan {
  if (r.admin) return { edit: true, remove: true, restore: true };
  if (!row.host_center_key || !r.centerKeys.has(row.host_center_key)) return { edit: false, remove: false, restore: false };
  if (r.staff) return { edit: true, remove: true, restore: true };
  if (!r.editor) return { edit: false, remove: false, restore: false };
  const own = !!row.created_by_sub && row.created_by_sub === s.sub;
  return { edit: own || r.editor.editOthers, remove: own || r.editor.deleteOthers, restore: false };
}

/** 有效報名數：已開通、免費報名、待審核（不含已退回）。大於 0 的課程不能永久刪除，只能「下架封存」。 */
export async function registrationCount(db: D1Database, courseId: string): Promise<number> {
  const r = await db
    .prepare("SELECT (SELECT COUNT(*) FROM enrollments WHERE course_id = ?1) + (SELECT COUNT(DISTINCT o.id) FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.course_id = ?1 AND o.status = 'pending') AS n")
    .bind(courseId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/** 中心縮寫對照：centerKey（主辦中心的正規化名稱）→ 短網址縮寫。 */
/** 系列短網址（系列名稱 → 縮寫），素材的第二層網址用。 */
export async function seriesSlugMap(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db.prepare("SELECT slug, value FROM short_links WHERE kind = 'series'").all<{ slug: string; value: string }>();
  return new Map(results.map((r) => [r.value, r.slug]));
}

export async function centerSlugMap(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db.prepare("SELECT slug, value FROM short_links WHERE kind = 'center'").all<{ slug: string; value: string }>();
  return new Map(results.map((r) => [centerKey(r.value), r.slug]));
}

/**
 * 課程專屬網址：learn.hglobal1985.com/中心縮寫/英譯主講人-1。條件：有主講人、主辦中心已設定短網址；一旦產生就固定。
 * 編號＝同一主辦中心＋同一英譯姓名已有的最大編號 + 1（從 1 開始，不補零，需要時自然增加位數）。
 */
/** 續播的起點秒數：登入者這一堂還沒看完、上次停在區間中間才回傳；否則 null（從頭播）。 */
export async function resumePoint(ctx: Ctx, lessonId: string, start: number, end: number | null): Promise<number | null> {
  const s = ctx.session;
  if (!s) return null;
  const done = await ctx.db.prepare("SELECT 1 AS ok FROM lesson_progress WHERE member_sub = ? AND lesson_id = ?").bind(s.sub, lessonId).first();
  if (done) return null;
  const w = await ctx.db.prepare("SELECT position_sec FROM lesson_watch WHERE member_sub = ? AND lesson_id = ?").bind(s.sub, lessonId).first<{ position_sec: number | null }>();
  const p = w?.position_sec;
  if (p == null || p < start + 5 || (end != null && p > end - 10)) return null;
  return p;
}

/** 這門課是不是「清單卡」（沒有章節，只有其他教材）。 */
export async function isListCourse(ctx: Ctx, courseId: string): Promise<boolean> {
  return (await ctx.db.prepare("SELECT is_list FROM courses WHERE id = ?").bind(courseId).first<{ is_list: number }>())?.is_list === 1;
}

/** 課程「費用與審核」的審核窗口：審核群組（成員）、指定身份、指定的會員。 */
export async function reviewDesk(ctx: Ctx, id: string): Promise<ReviewDesk> {
  const c = await ctx.db.prepare("SELECT review_group_id, review_roles FROM courses WHERE id = ?").bind(id).first<{ review_group_id: string | null; review_roles: string }>();
  if (!c) return fail(404, "not_found", "找不到這門課程");
  const [g, gm, m] = await ctx.db.batch([
    ctx.db.prepare("SELECT name FROM review_groups WHERE id = ?").bind(c.review_group_id ?? ""),
    ctx.db.prepare("SELECT member_name, center_label, duty FROM review_group_members WHERE group_id = ? ORDER BY center_label, created_at").bind(c.review_group_id ?? ""),
    ctx.db.prepare("SELECT member_sub, member_name, created_at FROM course_reviewers WHERE course_id = ? ORDER BY created_at").bind(id),
  ]);
  return {
    groupId: c.review_group_id,
    groupName: (g.results[0] as { name: string } | undefined)?.name ?? null,
    groupMembers: (gm.results as { member_name: string; center_label: string; duty: string }[]).map((r) => ({ name: r.member_name, center: r.center_label, duty: r.duty })),
    roles: c.review_roles.split(",").filter((r): r is ReviewRole => (REVIEW_ROLES as readonly string[]).includes(r)),
    members: (m.results as { member_sub: string; member_name: string; created_at: string }[]).map((r) => ({ sub: r.member_sub, name: r.member_name, addedAt: r.created_at })),
  };
}

export type InviteRow = { course_id: string; created_by_sub: string; expires_at: string; used_by_sub: string | null; title: string };
export async function inviteOf(ctx: Ctx, token: string): Promise<InviteRow> {
  const r = await ctx.db.prepare("SELECT i.course_id, i.created_by_sub, i.expires_at, i.used_by_sub, c.title FROM review_invites i JOIN courses c ON c.id = i.course_id WHERE i.token_hash = ?").bind(await sha256(token)).first<InviteRow>();
  return r ?? fail(404, "invite_not_found", "找不到這個邀請，請確認網址是否完整");
}
/** open＝可以接受；mine＝自己已經接受過；used＝被別人用掉；expired＝超過 24 小時。 */
export function inviteState(inv: InviteRow, sub: string): "open" | "mine" | "used" | "expired" {
  if (inv.used_by_sub) return inv.used_by_sub === sub ? "mine" : "used";
  return inv.expires_at < iso() ? "expired" : "open";
}

export async function ensureCourseUrl(ctx: Ctx, courseId: string): Promise<void> {
  try {
    const c = await ctx.db.prepare("SELECT teacher, title, no_speaker, host_center_key, url_name FROM courses WHERE id = ?").bind(courseId).first<{ teacher: string | null; title: string; no_speaker: number; host_center_key: string | null; url_name: string | null }>();
    // 專屬網址的名字：有主講人＝主講人英譯；勾了「無」＝課程名稱英譯（杜杜龍 2026-11-19）。
    if (!c || c.url_name || (c.no_speaker !== 1 && !c.teacher?.trim())) return;
    // 有主辦中心：要用中心的縮寫（中心還沒設定縮寫就先不產生）；沒有主辦中心（總部）：用保留縮寫 hq。
    if (c.host_center_key && !(await centerSlugMap(ctx.db)).has(c.host_center_key)) return;
    const base = c.no_speaker === 1 ? romanizeTitle(c.title) : romanizeName(c.teacher ?? "");
    if (!base) return;
    const like = `${base.replace(/[%_\\]/g, "")}-%`;
    const used = c.host_center_key
      ? await ctx.db.prepare("SELECT url_name FROM courses WHERE host_center_key = ? AND url_name LIKE ? ESCAPE '\\'").bind(c.host_center_key, like).all<{ url_name: string }>()
      : await ctx.db.prepare("SELECT url_name FROM courses WHERE host_center_key IS NULL AND url_name LIKE ? ESCAPE '\\'").bind(like).all<{ url_name: string }>();
    const olds = await ctx.db.prepare("SELECT url_name FROM course_url_aliases WHERE scope = ? AND url_name LIKE ? ESCAPE '\\'").bind(c.host_center_key ? centerKey(c.host_center_key) : "", like).all<{ url_name: string }>().catch(() => ({ results: [] as { url_name: string }[] }));
    let max = 0;
    for (const r of [...used.results, ...olds.results]) {
      const m = /-(\d+)$/.exec(r.url_name);
      if (m && r.url_name.slice(0, -m[0].length) === base) max = Math.max(max, Number(m[1]));
    }
    await ctx.db.prepare("UPDATE courses SET url_name = ? WHERE id = ? AND url_name IS NULL").bind(`${base}-${max + 1}`, courseId).run();
  } catch {
    /* 不影響儲存 */
  }
}

/** 補齊全站（或某個主辦中心）還沒有專屬網址的課程，依建立時間編號。 */
export async function backfillCourseUrls(ctx: Ctx, centerKeyOnly?: string): Promise<number> {
  // 把舊的補零編號（-001）改成不補零（-1）；撞名就略過。
  try {
    const old = await ctx.db.prepare("SELECT id, url_name FROM courses WHERE url_name GLOB '*-0[0-9]*'").all<{ id: string; url_name: string }>();
    for (const r of old.results) {
      const m = /^(.*-)(\d+)$/.exec(r.url_name);
      if (!m) continue;
      try {
        await ctx.db.prepare("UPDATE courses SET url_name = ? WHERE id = ?").bind(`${m[1]}${Number(m[2])}`, r.id).run();
      } catch {
        /* 撞名略過 */
      }
    }
  } catch {
    /* 不影響補網址 */
  }
  const { results } = await ctx.db
    .prepare(`SELECT id FROM courses WHERE url_name IS NULL AND (teacher <> '' OR no_speaker = 1)${centerKeyOnly ? " AND host_center_key = ?" : ""} ORDER BY created_at, id`)
    .bind(...(centerKeyOnly ? [centerKeyOnly] : []))
    .all<{ id: string }>();
  for (const r of results) await ensureCourseUrl(ctx, r.id);
  const left = await ctx.db.prepare("SELECT COUNT(*) AS n FROM courses WHERE url_name IS NOT NULL").first<{ n: number }>();
  return left?.n ?? 0;
}

/** 主辦中心：主辦單位裡第一個不是總部的名稱。 */
export const hostCenterOf = (hostUnit: string) => splitCats(hostUnit).find((x) => x !== HQ_UNIT) ?? "";


/** 教材的外部連結與上傳檔案（每個教材一條，依建立順序）。 */
export function linkRowsOf(db: D1Database, courseIds: string[]) {
  return db
    .prepare(`SELECT id, lesson_id, att_type, link_url, kind FROM lesson_attachments WHERE course_id IN (${courseIds.map(() => "?").join(",")}) AND kind IN ('link', 'file') ORDER BY created_at`)
    .bind(...courseIds)
    .all<{ id: string; lesson_id: string; att_type: AttachmentType; link_url: string | null; kind: string }>()
    .then((r) => r.results);
}
/** 連結區塊的來源：來源清單裡，那個區塊之後、下一個區塊之前的項目。 */
export const LINKED_ITEMS_SQL = `SELECT id, position, title, sharer, sharer_rank, sharer_title, duration_minutes, media_type, media_ref, start_seconds, end_seconds, event_date, cover_key, poster_key, art_version, auto_cover, kind, is_full, is_speaker, is_summary, brand_id, categories, in_sheet, link_block_id FROM lessons WHERE course_id = ? AND position > ? AND position < COALESCE((SELECT MIN(position) FROM lessons WHERE course_id = ? AND kind = 'section' AND position > ?), 1000000000) AND kind <> 'section' AND is_full = 0 ORDER BY position`;

/**
 * 某門課程對目前使用者的鎖定狀態（與課程頁 lockedAll 同一條規則）。連結區塊（品牌卡的「成交百寶箱」）與區塊照片，一律用「來源課程最新的報名資格設定」判斷（杜杜龍 2026-11-24）：
 * 例如成交百寶箱設「12% 以上（會長也可）、不用報名」，符合的人直接瀏覽，不符合的人看到鎖頭遮罩與原因。lines＝遮罩上的文字。
 */
export type LockState = { locked: boolean; manages: boolean; lines: string[] };
export async function lockStateOf(ctx: Ctx, row: CourseRow, rankMap: Map<string, Rank>, state: MemberState, rights: Rights | null, eligibility: Map<string, boolean>): Promise<LockState> {
  const s = ctx.session;
  const can = s && rights ? courseCan(rights, s, row) : { edit: false, remove: false, restore: false };
  const manages = can.edit || can.remove || can.restore;
  const eligible = row.invite_only === 1 || row.min_rank_code === "none" || eligibility.get(row.min_rank_code) === true || byPresident(s, row);
  const watchFree = !!s && materialLike(row) && row.status === "published" && row.price_twd === 0 && row.price_tba !== 1 && (row.min_rank_code === "none" || eligibility.get(row.min_rank_code) === true || byPresident(s, row));
  const rankLocked = !manages && row.is_public !== 1 && row.price_twd === 0 && row.price_tba !== 1 && row.invite_only !== 1 && row.min_rank_code !== "none" && !eligible;
  const scopeBlocked = !manages && !scopeAllows(row.view_scope, s) && !keepsAccess(state, row);
  const locked = scopeBlocked || ((!manages || !materialLike(row)) && (rankLocked || !(state.enrolled.has(row.id) || (row.is_public === 1 && materialLike(row)) || watchFree)));
  if (!locked) return { locked: false, manages, lines: [] };
  const need = row.min_rank_code !== "none" ? `限${rankMap.get(row.min_rank_code)?.name ?? row.min_rank_code}獎銜以上使用${row.allow_president === 1 ? "（會長也可）" : ""}` : "";
  const first = !s ? "登入並符合獎銜才能使用" : !eligible ? "獎銜不符，目前無法使用" : "報名後才能使用";
  return { locked: true, manages, lines: [first, ...(need && !eligible ? [need] : [])] };
}
/** 區塊照片的 owner_key（課程編號或區塊編號）→ 這個人現在能不能看（公開讀取照片清單用）。 */
export async function lockStateOfKey(ctx: Ctx, courseId: string): Promise<LockState> {
  const row = await ctx.db.prepare(`${COURSE_SELECT} WHERE c.id = ?`).bind(courseId).first<CourseRow>();
  if (!row) return { locked: false, manages: false, lines: [] };
  const [rankMap, state, rights] = await Promise.all([ranks(ctx.db), memberCourseState(ctx.db, ctx.session?.sub), ctx.session ? rightsOf(ctx) : Promise.resolve(null)]);
  return lockStateOf(ctx, row, rankMap, state, rights, await eligibilityFor(ctx.session, rankMap, row.min_rank_code === "none" ? [] : [row.min_rank_code]));
}

/** 一次算出多門課的鎖定狀態（搜尋結果用）：課程列一次查完，獎銜表、報名狀態、權限、資格也各只查一次，不再每門課重查（以前 100 筆結果要等近 10 秒）。 */
export async function lockStatesOf(ctx: Ctx, courseIds: string[]): Promise<Map<string, LockState>> {
  const out = new Map<string, LockState>();
  const ids = [...new Set(courseIds)];
  if (!ids.length) return out;
  const rows: CourseRow[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    rows.push(...(await ctx.db.prepare(`${COURSE_SELECT} WHERE c.id IN (${part.map(() => "?").join(",")})`).bind(...part).all<CourseRow>()).results);
  }
  const [rankMap, state, rights] = await Promise.all([ranks(ctx.db), memberCourseState(ctx.db, ctx.session?.sub), ctx.session ? rightsOf(ctx) : Promise.resolve(null)]);
  const eligibility = await eligibilityFor(ctx.session, rankMap, [...new Set(rows.map((r) => r.min_rank_code).filter((c) => c !== "none"))]);
  for (const r of rows) out.set(r.id, await lockStateOf(ctx, r, rankMap, state, rights, eligibility));
  for (const id of ids) if (!out.has(id)) out.set(id, { locked: false, manages: false, lines: [] });
  return out;
}

export async function courseDetail(ctx: Ctx, id: string): Promise<CourseDetail> {
  const s = ctx.session;
  // 這一頁需要的資料全部同時查（2026-11-21 載入速度優化：以前一個查完才查下一個，課程頁要等 12 趟資料庫來回）。
  // 權限、可見範圍的判斷仍在查完之後才做，查到的資料不會外流。
  const [row, rights, rankMap, state, lessons, done, ownLinks, centerSlugs, seriesSlugs, brands, blocks] = await Promise.all([
    ctx.db.prepare(`${COURSE_SELECT} WHERE c.id = ?`).bind(id).first<CourseRow>(),
    s ? rightsOf(ctx) : Promise.resolve(null),
    ranks(ctx.db),
    memberCourseState(ctx.db, s?.sub),
    ctx.db
      .prepare("SELECT id, position, title, sharer, sharer_rank, sharer_title, duration_minutes, media_type, media_ref, start_seconds, end_seconds, event_date, cover_key, poster_key, art_version, auto_cover, kind, is_full, is_speaker, is_summary, brand_id, categories, in_sheet, link_block_id FROM lessons WHERE course_id = ? ORDER BY position")
      .bind(id)
      .all<{ id: string; position: number; title: string; sharer: string; sharer_rank: string; sharer_title: string; duration_minutes: number; media_type: MediaType; media_ref: string | null; start_seconds: number | null; end_seconds: number | null; event_date: string | null; cover_key: string | null; poster_key: string | null; art_version: number; auto_cover: number; kind: string; is_full: number; is_speaker: number; is_summary: number; brand_id: string | null; categories: string; in_sheet: number; link_block_id: string | null }>(),
    s ? ctx.db.prepare("SELECT lesson_id FROM lesson_progress WHERE member_sub = ? AND course_id = ?").bind(s.sub, id).all<{ lesson_id: string }>() : Promise.resolve({ results: [] as { lesson_id: string }[] }),
    linkRowsOf(ctx.db, [id]),
    centerSlugMap(ctx.db),
    seriesSlugMap(ctx.db),
    loadBrands(ctx.db),
    loadBlocks(ctx.db),
  ]);
  // 未登入的訪客：只有「完全公開」且已上架的課程可以看；其他一律要求登入。
  if (!s && (!row || row.status !== "published" || (row.view_scope !== "all" && row.view_scope !== "link_guest"))) return fail(401, "unauthenticated", "請先登入");
  if (!row) return fail(404, "not_found", "找不到這門課程");
  const can = s && rights ? courseCan(rights, s, row) : { edit: false, remove: false, restore: false };
  const manages = can.edit || can.remove || can.restore;
  // 未上架：只有能管理的人看得到。下架封存：管理者，以及有報名、審核中或學習過的學員（照常上課）。
  const archivedForMe = row.status === "archived" && (state.enrolled.has(id) || state.pending.has(id) || state.started.has(id));
  if (row.status !== "published" && !manages && !archivedForMe) return fail(404, "not_found", "找不到這門課程");
  // 誰可以瀏覽：不在範圍內的登入者（管理者、已報名／審核中／學習過的除外）看不到這門課。
  if (!manages && !scopeAllows(row.view_scope, s) && !keepsAccess(state, row)) return fail(404, "not_found", "找不到這門課程");
  const completed = new Set(done.results.map((r) => r.lesson_id));
  // 連結區塊（品牌資訊卡，杜杜龍 2026-11-18）：這個區塊的內容與封面來自另一份清單的區塊——把來源區塊底下的項目接在區塊標題後面，編輯、排序、播放都回到來源清單。
  type LRow = (typeof lessons.results)[number] & { src?: string };
  const lessonRows: LRow[] = [];
  const linkCover = new Map<string, string>();
  const sourceCourses: string[] = [];
  const sourceCourseOf = new Map<string, string>();
  const photoKeyOf = new Map<string, string>(); // 區塊 → 放照片的區塊編號（課程開放區塊照片時才有；杜杜龍 2026-11-24）
  if (row.block_photos === 1) for (const l of lessons.results) if (l.kind === "section" && !l.link_block_id) photoKeyOf.set(l.id, l.id);
  // 連結區塊（只有品牌卡有）：每個連結區塊各自的來源一起查，再依原本順序接回去。
  const linked = await Promise.all(
    lessons.results.map(async (l) => {
      if (!l.link_block_id) return null;
      const sec = await ctx.db.prepare("SELECT s.course_id, s.position, c.series, c.cover_key AS ckey, c.art_version AS cver, c.block_photos AS bp FROM lessons s JOIN courses c ON c.id = s.course_id WHERE s.id = ? AND s.kind = 'section'").bind(l.link_block_id).first<{ course_id: string; position: number; series: string | null; ckey: string | null; cver: number; bp: number }>();
      if (!sec) return null;
      const [{ results: items }, art] = await Promise.all([
        ctx.db
          .prepare(LINKED_ITEMS_SQL)
          .bind(sec.course_id, sec.position, sec.course_id, sec.position)
          .all<LRow>(),
        sec.series ? ctx.db.prepare("SELECT cover_key, edm_key, art_version FROM series_art WHERE series = ?").bind(sec.series).first<{ cover_key: string | null; edm_key: string | null; art_version: number }>() : Promise.resolve(null),
      ]);
      return { sec, items, art };
    }),
  );
  lessons.results.forEach((l, i) => {
    lessonRows.push(l);
    const hit = linked[i];
    if (!hit) return;
    const { sec, items, art } = hit;
    sourceCourses.push(sec.course_id);
    sourceCourseOf.set(l.id, sec.course_id);
    if (sec.bp === 1) photoKeyOf.set(l.id, l.link_block_id!); // 區塊照片：連結區塊的照片存在來源區塊
    for (const it of items) lessonRows.push({ ...it, src: sec.course_id });
    // 封面＝來源清單的系列封面（上傳的封面優先，沒有再用首頁圖）；之後來源修改，這裡自動一致。
    const key = art?.cover_key || art?.edm_key;
    if (key) linkCover.set(l.id, pubUrl(key, art!.art_version));
    else if (sec.ckey) linkCover.set(l.id, pubUrl(sec.ckey, sec.cver)); // 系列沒有封面時用來源課程自己的封面（成交百寶箱，杜杜龍 2026-11-24）
  });
  // 其他教材的外部連結（每個教材一條）：類型給所有人（畫面顯示官方 Logo），網址只給有權限看的人。
  const linkRows = { results: sourceCourses.length ? [...ownLinks, ...(await linkRowsOf(ctx.db, sourceCourses))] : ownLinks };
  const linkOf = new Map<string, { type: AttachmentType; url: string }>();
  // 上傳的檔案（雲端硬碟或舊的網站儲存空間）：網址一律是 dl://附件編號，不是真正的網址；畫面按下載時要先通過權限檢查才拿得到一次性下載連結。外部連結直接給原網址。
  for (const r of linkRows.results) if (!linkOf.has(r.lesson_id)) linkOf.set(r.lesson_id, { type: r.att_type, url: r.kind === "file" || (r.link_url ?? "").startsWith("drive:") ? `dl://${r.id}` : (r.link_url ?? "") });
  const groupPos = new Map<string, number>();
  {
    const n = { chapter: 0, material: 0 };
    for (const l of lessonRows) groupPos.set(l.id, l.kind === "section" ? 0 : ++n[l.kind === "material" ? "material" : "chapter"]);
  }
  ctx.centerSlugs = centerSlugs;
  ctx.seriesSlugs = seriesSlugs;
  ctx.brands = brands;
  ctx.blocks = blocks;
  // 區塊照片（杜杜龍 2026-11-24）：開放的課程，每個區塊帶出自己的照片（cover_media，owner_key＝區塊編號；連結區塊用來源區塊）。
  if (row.block_photos === 1 && ctx.defer) kickFilePhotos(ctx.env, ctx.defer);
  const photosOf = new Map<string, CoverMediaItem[]>();
  const photoKeys = [...new Set(photoKeyOf.values())];
  if (photoKeys.length) {
    const { results } = await ctx.db
      .prepare(`SELECT cm.id, cm.owner_key, cm.scope, cm.kind, cm.r2_key, cm.poster_key, cm.width, cm.height, cm.duration_sec, cm.scene_text, cm.ocr_text, cm.folder_id, COALESCE(NULLIF(mp.name, ''), cm.uploader_name) AS uploader_name, COALESCE(NULLIF(mp.avatar, ''), cm.uploader_avatar) AS uploader_avatar FROM cover_media cm LEFT JOIN member_profiles mp ON mp.sub = cm.created_by WHERE cm.owner_kind = 'course' AND cm.scope = 'cover' AND cm.owner_key IN (${photoKeys.map(() => "?").join(",")}) ORDER BY cm.owner_key, cm.position`)
      .bind(...photoKeys)
      .all<{ id: string; owner_key: string; folder_id: string | null; scene_text: string; ocr_text: string; uploader_name: string | null; uploader_avatar: string | null; scope: CoverScope; kind: "image" | "video"; r2_key: string; poster_key: string | null; width: number; height: number; duration_sec: number }>();
    for (const r of results) photosOf.set(r.owner_key, [...(photosOf.get(r.owner_key) ?? []), coverItem(r)]);
  }
  const [eligibility, canRoster, registrations] = await Promise.all([eligibilityFor(s, rankMap, [row.min_rank_code, DIAMOND]), canSeeRoster(ctx, s, row, manages), manages ? registrationCount(ctx.db, id) : Promise.resolve(0)]);
  const summaryNow = summarize(row, ctx, rankMap, state, eligibility);
  const watchFree = summaryNow.watchFree;
  const admin = manages;
  // 免費課程後來才加上獎銜限制：先前自動完成的報名不算資格，不符合的人看不到章節內容（杜杜龍 2026-11-18）。
  const rankLocked = !admin && row.is_public !== 1 && row.price_twd === 0 && row.price_tba !== 1 && row.invite_only !== 1 && row.min_rank_code !== "none" && !summaryNow.eligible;
  const lockedAll = (!admin || !materialLike(row)) && (rankLocked || !(state.enrolled.has(id) || (row.is_public === 1 && materialLike(row)) || watchFree));
  // 連結區塊的來源課程各自的鎖定狀態（杜杜龍 2026-11-24）：連結過來的教材與照片，用來源課程最新的報名資格設定判斷。
  const srcLock = new Map<string, LockState>();
  const srcIds = [...new Set(sourceCourses)];
  if (srcIds.length) {
    const srcRows = (await Promise.all(srcIds.map((sid) => ctx.db.prepare(`${COURSE_SELECT} WHERE c.id = ?`).bind(sid).first<CourseRow>()))).filter((r): r is CourseRow => !!r);
    const srcElig = await eligibilityFor(s, rankMap, [...new Set(srcRows.map((r) => r.min_rank_code).filter((c) => c !== "none"))]);
    for (const r of srcRows) srcLock.set(r.id, await lockStateOf(ctx, r, rankMap, state, rights, srcElig));
  }
  const lockOf = (l: { id: string; src?: string }): LockState | undefined => srcLock.get(l.src ?? sourceCourseOf.get(l.id) ?? "");
  return {
    ...summaryNow,
    canRoster,
    ...(manages ? { can } : {}),
    description: row.description ?? "",
    lessons: [...lessonRows.map((l) => ({
      id: l.id,
      ...(l.src ? { courseId: l.src } : {}),
      // 顯示用序號：章節與教材各自從 1 開始編號（資料庫裡的 position 是整門課共用、不重複的排序）。
      position: groupPos.get(l.id)!,
      material: l.kind === "material" || l.kind === "section",
      ...(l.kind === "section"
        ? { section: true, ...(l.link_block_id ? { linkedBlockId: l.link_block_id, linkedCourseId: sourceCourseOf.get(l.id) } : {}), inSheet: l.in_sheet === 1, categories: l.categories, brandId: l.brand_id, brandName: ctx.brands?.find((b) => b.id === l.brand_id)?.name ?? null, brand: brandForBlock(ctx, l.brand_id, l.cover_key), ...(l.link_block_id && lockOf(l)?.locked ? { blockLocked: true, lockLines: lockOf(l)!.lines } : {}), ...(photoKeyOf.has(l.id) ? (() => { const all = photosOf.get(photoKeyOf.get(l.id)!) ?? []; return { photoKey: photoKeyOf.get(l.id), photoCount: all.length, photos: all }; })() : {}) }
        : {}),
      ...(l.is_full === 1 ? { full: true } : {}),
      title: l.title,
      minutes: l.duration_minutes,
      completed: completed.has(l.id),
      kind: l.media_type === "audio" ? ("audio" as const) : ("video" as const),
      start: l.start_seconds,
      end: l.end_seconds,
      // 章節日期空白＝跟著課程日期（課程日期改了章節跟著變）；dateFollows 給編輯畫面判斷。
      eventDate: l.event_date ?? row.event_start,
      dateFollows: l.event_date === null,
      ...(l.kind === "chapter" ? { isSpeaker: l.is_speaker === 1, isSummary: l.is_summary === 1 } : l.kind === "material" ? { isSpeaker: l.is_speaker === 1 } : {}),
      sharer: l.sharer,
      sharerRank: l.sharer_rank,
      sharerRankName: rankMap.get(l.sharer_rank)?.name ?? "",
      sharerTitle: l.sharer_title,
      // 章節／教材封面：手動上傳的優先；沒有且是 YouTube 影片＝用 YouTube 縮圖（coverAuto＝不是上傳的，編輯畫面不當成已上傳）；其餘 null＝用課程封面。
      coverUrl: linkCover.has(l.id) ? linkCover.get(l.id)! : l.cover_key ? pubUrl(l.cover_key, l.art_version) : ytThumbOf(l.media_type, l.media_ref),
      ...(!linkCover.has(l.id) && !l.cover_key && ytThumbOf(l.media_type, l.media_ref) ? { coverAuto: true } : {}),
      posterUrl: l.poster_key ? pubUrl(l.poster_key, l.art_version) : null,
      // 還沒上傳／設定內容的章節（新增課程時自動建立的空白示範章節）＝敬請期待。
      ready: (l.media_type !== "demo" && !!l.media_ref) || l.duration_minutes > 0 || (l.kind === "material" && linkOf.has(l.id)),
      // 完全公開的課程：任何人（含訪客與會員）都可以看章節，不需要報名。
      locked: l.kind === "section" ? lockedAll : (lockOf(l)?.locked ?? lockedAll),
      // 清單項目的圖示類型（連結類型，或清單裡的 YouTube 影片）；規則在 link-rules.ts（杜杜龍 2026-11-18）。
      ...(l.kind === "material" && !l.is_full && itemIconType(linkOf.get(l.id)?.type, l.media_type, true) ? { iconType: itemIconType(linkOf.get(l.id)?.type, l.media_type, true) } : {}),
      ...(l.kind === "material" && linkOf.get(l.id) ? { linkType: linkOf.get(l.id)!.type, ...((lockOf(l)?.locked ?? lockedAll) && !(lockOf(l)?.manages ?? admin) ? {} : { linkUrl: linkOf.get(l.id)!.url }) } : {}),
      // 影片來源只給管理員（編輯用）；學員一律透過 playback API 取得授權後的播放資訊。
      ...(admin ? { media: { type: l.media_type, ref: l.media_ref } } : {}),
    }))],
    ...(admin
      ? {
          admin: {
            hostCenterKey: row.host_center_key,
            freeFrom: row.free_from,
            freeUntil: row.free_until,
            reviewGroupId: row.review_group_id,
            basePriceTwd: row.price_twd,
            can,
            registrations,
            editedByName: row.edited_by_name,
            editedAt: row.edited_at,
            updatedAt: row.updated_at,
            mine: !!s && !!row.created_by_sub && row.created_by_sub === s.sub,
          },
        }
      : {}),
  };
}

/** 能否觀看：管理員可預覽；其他人需已報名並開通該課程（完全公開的課程不用報名）。 */
export async function canWatch(ctx: Ctx, courseId: string): Promise<boolean> {
  const s = ctx.session;
  if (!s) {
    // 訪客：只有完全公開、已上架的「清單／教材類」可以看；課程類一律要登入並手動報名（杜杜龍 2026-11-22）。
    const pub = await ctx.db.prepare(`SELECT 1 AS ok FROM courses WHERE id = ? AND is_public = 1 AND invite_only = 0 AND status = 'published' AND ${MATERIAL_LIKE_SQL}`).bind(courseId).first();
    return !!pub;
  }
  // 管理員與課程管理者也一樣：課程類要先報名才能播放（杜杜龍 2026-11-22）；只有清單／教材類可以不報名直接預覽。
  const isMaterial = !!(await ctx.db.prepare(`SELECT 1 AS ok FROM courses WHERE id = ? AND ${MATERIAL_LIKE_SQL}`).bind(courseId).first());
  if (isMaterial && s.role === "admin") return true;
  if ((await ctx.db.prepare(`SELECT 1 AS ok FROM courses WHERE id = ? AND is_public = 1 AND invite_only = 0 AND status = 'published' AND ${MATERIAL_LIKE_SQL}`).bind(courseId).first())) return true; // 完全公開的清單／教材類，會員也不必報名（課程類即使免費也要報名，杜杜龍 2026-11-22）
  const rights = await rightsOf(ctx);
  if (isMaterial && rights.any) {
    const c = await ctx.db.prepare("SELECT host_center_key, created_by_sub FROM courses WHERE id = ?").bind(courseId).first<{ host_center_key: string | null; created_by_sub: string }>();
    if (c) {
      const can = courseCan(rights, s, c);
      if (can.edit || can.remove || can.restore) return true;
    }
  }
  const row = await ctx.db.prepare("SELECT 1 AS ok FROM enrollments WHERE member_sub = ? AND course_id = ? LIMIT 1").bind(s.sub, courseId).first();
  if (row) return !(await freeRankBlocked(ctx, courseId)); // 免費課程的「報名」是自動完成的，不算資格：之後改成有獎銜限制，不符合的人就不能看
  return freeWatchable(ctx, courseId); // 設定免費的課程：符合資格就能直接看，不用報名
}

/** 免費（費用 0）、有獎銜限制、而這位會員不符合（會長例外只在勾選時）：即使先前自動報名過也不能看（杜杜龍 2026-11-18）。付費課程的報名是繳費換來的，不受影響。 */
export async function freeRankBlocked(ctx: Ctx, courseId: string): Promise<boolean> {
  const s = ctx.session;
  if (!s || s.role === "admin") return false; // 管理員不受獎銜與瀏覽範圍限制（仍要先報名）
  const c = await ctx.db.prepare("SELECT min_rank_code, allow_president, price_twd, price_tba, view_scope, invite_only FROM courses WHERE id = ?").bind(courseId).first<{ invite_only: number; min_rank_code: string; allow_president: number; price_twd: number; price_tba: number; view_scope: ViewScope }>();
  if (!c || c.price_twd !== 0 || c.price_tba === 1) return false;
  if (!scopeAllows(c.view_scope, s)) return true; // 後來把「誰能瀏覽」改嚴：先前自動報名的不在範圍內也不能看
  if (c.invite_only === 1 || c.min_rank_code === "none" || byPresident(s, c)) return false; // 指定邀請制不看獎銜
  return (await eligibilityFor(s, await ranks(ctx.db), [c.min_rank_code])).get(c.min_rank_code) !== true;
}

/** 清單／素材類：免費、已上架、而且這位會員符合資格（獎銜）就能直接使用，不用報名；課程類一律要手動報名（杜杜龍 2026-11-18）。 */
export async function freeWatchable(ctx: Ctx, courseId: string): Promise<boolean> {
  const s = ctx.session;
  if (!s) return false;
  const c = await ctx.db
    .prepare(`SELECT min_rank_code, allow_president, price_twd, price_tba FROM courses WHERE id = ? AND status = 'published' AND ${MATERIAL_LIKE_SQL}`)
    .bind(courseId)
    .first<{ min_rank_code: string; allow_president: number; price_twd: number; price_tba: number }>();
  if (!c || c.price_twd !== 0 || c.price_tba === 1) return false;
  if (byPresident(s, c)) return true;
  const eligibility = await eligibilityFor(s, await ranks(ctx.db), [c.min_rank_code]);
  return eligibility.get(c.min_rank_code) === true;
}

/** 打開課程頁：不再自動報名（課程一律手動報名，報名＝訂閱更新通知）；已報名／學習過但被隱藏的恢復顯示。 */
export async function openFreeCourse(ctx: Ctx, courseId: string): Promise<void> {
  const s = ctx.session;
  if (!s || s.role === "admin") return;
  await ctx.db.batch([
    ctx.db.prepare("UPDATE enrollments SET hidden = 0 WHERE member_sub = ? AND course_id = ? AND hidden = 1").bind(s.sub, courseId),
    ctx.db.prepare("UPDATE learning_started SET hidden = 0 WHERE member_sub = ? AND course_id = ? AND hidden = 1").bind(s.sub, courseId),
  ]);
}

/** 刪除課程前的影響：多少筆報名紀錄、多少人已開通、已確認收款多少（供「輸入 YES」確認畫面顯示）。 */
export async function courseDeleteImpact(db: D1Database, id: string): Promise<CourseDeleteImpact> {
  const c = await db.prepare("SELECT title FROM courses WHERE id = ?").bind(id).first<{ title: string }>();
  if (!c) return fail(404, "not_found", "找不到這門課程");
  const r = await db
    .prepare(
      `SELECT COUNT(DISTINCT i.order_id) AS registrations,
              COUNT(DISTINCT CASE WHEN o.status = 'pending' THEN o.id END) AS pending,
              COUNT(DISTINCT CASE WHEN o.status = 'opened' THEN o.id END) AS opened,
              COALESCE(SUM(CASE WHEN o.status = 'opened' THEN i.price_twd ELSE 0 END), 0) AS paid
       FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.course_id = ?`,
    )
    .bind(id)
    .first<{ registrations: number; pending: number; opened: number; paid: number }>();
  const [students, comments] = await Promise.all([
    db.prepare("SELECT COUNT(DISTINCT member_sub) AS n FROM enrollments WHERE course_id = ?").bind(id).first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM course_comments WHERE course_id = ?").bind(id).first<{ n: number }>(),
  ]);
  return { title: c.title, registrations: r?.registrations ?? 0, pending: r?.pending ?? 0, opened: r?.opened ?? 0, students: students?.n ?? 0, comments: comments?.n ?? 0, paidTwd: r?.paid ?? 0 };
}

/** 公開圖片（封面、EDM）的網址；版本號讓更新後瀏覽器改抓新圖。 */
/** 頁面瀏覽次數 +1 並回傳累計（中心頁、系列頁共用；杜杜龍 2026-11-16：每進入一次就算一次，不分是否同一人）。 */
export const VIEW_BASE = 688; // 所有封面（中心、系列、課程、教材清單）顯示的點閱數都加 688（杜杜龍 2026-11-17 中心、2026-11-18 擴大到全部封面，只影響顯示）
export const SUBSCRIBER_BASE = 688; // 每個中心顯示的訂閱人數從 688 開始算（杜杜龍 2026-11-17）

/** 系列的訂閱沿用中心訂閱表，用「series:」開頭的鍵區分。 */
export const seriesSubKey = (name: string) => `series:${name.trim()}`;
/** 課程／清單頁的訂閱（杜杜龍 2026-11-18：所有課程與教材清單的封面都有訂閱鈕）：同一張表，用「course:」開頭的鍵。 */
export const courseSubKey = (id: string) => `course:${id}`;

export async function subscriptionState(ctx: Ctx, key: string): Promise<{ count: number; subscribed: boolean }> {
  const n = await ctx.db.prepare("SELECT COUNT(*) AS n FROM center_subscriptions WHERE center_key = ?").bind(key).first<{ n: number }>();
  const mine = ctx.session ? await ctx.db.prepare("SELECT 1 AS ok FROM center_subscriptions WHERE member_sub = ? AND center_key = ?").bind(ctx.session.sub, key).first() : null;
  return { count: SUBSCRIBER_BASE + (n?.n ?? 0), subscribed: !!mine };
}

/** 中心課表的月份參數（YYYY-MM）。 */
export function scheduleYm(v: string | null): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec((v ?? "").trim());
  if (!m || Number(m[1]) < 2000 || Number(m[1]) > 2100) return fail(400, "invalid_month", "請選擇正確的年月");
  return `${m[1]}-${m[2]}`;
}

/** 中心每月課表：新的月份在前（公開）。 */
export async function schedulesOf(db: D1Database, key: string): Promise<{ items: { ym: string; url: string }[] }> {
  const { results } = await db.prepare("SELECT ym, image_key, version FROM center_schedules WHERE center_key = ? ORDER BY ym DESC").bind(key).all<{ ym: string; image_key: string; version: number }>();
  return { items: results.map((r) => ({ ym: r.ym, url: pubUrl(r.image_key, r.version) })) };
}

/**
 * 公告（杜杜龍 2026-11-21 模組化）：中心、系列、首頁共用同一張表，用 center_key 欄位存範圍鍵——中心＝中心鍵、系列＝`series:名稱`、首頁＝`home`。
 * 誰能新增／修改／刪除：中心＝能編輯該中心封面的人；系列與首頁＝只有超級管理員。
 */
export const HOME_BC_KEY = "home";
export type BcScope = "center" | "series" | "home";
export const bcScopeOf = (key: string): BcScope => (key === HOME_BC_KEY ? "home" : key.startsWith("series:") ? "series" : "center");
export type BcItem = { id: string; text: string; date: string; scope: BcScope; canEdit: boolean };

/** 這個人能不能管理某個範圍鍵的公告（只算權限，不查資料庫以外的東西）。 */
export async function canManageBc(ctx: Ctx, key: string): Promise<boolean> {
  if (!ctx.session) return false;
  if (bcScopeOf(key) !== "center") return ctx.session.roles.includes("super_admin");
  const rights = await rightsOf(ctx);
  if (rights.admin) return true;
  return !!rights.center && centerKey(rights.center.label) === key && !!(rights.staff || rights.editor?.editOthers);
}

/** 把要新增公告的範圍（中心／系列／首頁）轉成範圍鍵，同時檢查權限。 */
export async function bcTarget(ctx: Ctx, scope: unknown, name: unknown): Promise<{ s: Session; key: string; label: string; scope: BcScope }> {
  const label = typeof name === "string" ? name.trim().slice(0, 100) : "";
  if (scope === "home") return { s: requireSuperAdmin(ctx), key: HOME_BC_KEY, label: "首頁", scope: "home" };
  if (scope === "series") {
    const s = requireSuperAdmin(ctx);
    if (!label) fail(400, "series_required", "請指定系列");
    return { s, key: seriesSubKey(label), label, scope: "series" };
  }
  const { s, center } = await requireCenterArt(ctx, label);
  return { s, key: center.key, label: center.label, scope: "center" };
}

export async function broadcastsOf(ctx: Ctx, keys: string[]): Promise<{ seconds: number; items: BcItem[] }> {
  const db = ctx.db;
  const list = [...new Set(keys.filter(Boolean))];
  if (!list.length) return { seconds: 2, items: [] };
  const mark = list.map(() => "?").join(",");
  const [cfg, rows, can] = await Promise.all([
    db.prepare("SELECT seconds FROM center_broadcast_cfg WHERE center_key = ?").bind(list[0]).first<{ seconds: number }>(),
    db.prepare(`SELECT id, center_key, body, created_at FROM center_broadcasts WHERE center_key IN (${mark}) ORDER BY created_at DESC, rowid DESC LIMIT 100`).bind(...list).all<{ id: string; center_key: string; body: string; created_at: string }>(),
    Promise.all(list.map((k) => canManageBc(ctx, k))),
  ]);
  const canOf = new Map(list.map((k, i) => [k, can[i]!]));
  // 日期用台灣時間（資料庫存 UTC）。
  const tw = (iso: string) => new Date(Date.parse(iso.replace(" ", "T") + "Z") + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "/");
  return { seconds: cfg?.seconds ?? 2, items: rows.results.map((r) => ({ id: r.id, text: r.body, date: tw(r.created_at), scope: bcScopeOf(r.center_key), canEdit: canOf.get(r.center_key) ?? false })) };
}

/** 中心有新課程上架：通知這個中心的訂閱者（私密連結、清單卡、總部主辦的課不通知）。 */
export async function notifyNewCourse(ctx: Ctx, id: string): Promise<void> {
  try {
    const c = await ctx.db.prepare("SELECT title, host_unit, host_center_key AS hk, view_scope, is_list, series FROM courses WHERE id = ? AND status = 'published'").bind(id).first<{ title: string; host_unit: string; hk: string | null; series: string | null; view_scope: string; is_list: number }>();
    if (!c) return;
    const me = ctx.session?.sub ?? null;
    const kind = c.is_list === 1 ? "清單" : "課程";
    const title80 = c.title.slice(0, 80);
    let sent = 0;
    // 私密連結不通知訂閱者；其餘（課程與清單卡）通知所在中心與系列的訂閱者。
    if (!isPrivate(c.view_scope)) {
      if (c.hk) sent += await notifySubscribers(ctx.db, c.hk, `${hostCenterOf(c.host_unit) || c.hk}有新${kind}上架`, title80, `/course/${id}`, me);
      // 系列訂閱者（杜杜龍 2026-11-17）：系列有新課程上架也通知。
      if (c.series) sent += await notifySubscribers(ctx.db, seriesSubKey(c.series), `${c.series}有新${kind}上架`, title80, `/course/${id}`, me);
    }
    // 杜杜龍 2026-11-17：上架的人自己也會收到一則（不論有沒有訂閱者、是不是私密連結），用來確認通知有送出去。
    if (me) await notify(ctx.db, { sub: me }, `已送出「新${kind}上架」通知`, `${title80}（通知了 ${sent} 位訂閱者）`, `/course/${id}`).run();
  } catch {
    /* 通知失敗不影響上架 */
  }
}

/**
 * 系列裡的課程或清單新增章節／教材：通知這個系列的訂閱者（杜杜龍 2026-11-17）。已上架且非私密連結才通知訂閱者；
 * 同一門課同一類型 30 分鐘內只通知一次（連續新增很多章節不會一直洗版）；新增的人自己一定收到一則確認（含通知人數或「已合併」）。
 */
export async function notifyNewContent(ctx: Ctx, courseId: string, what: "章節" | "教材"): Promise<void> {
  try {
    const c = await ctx.db.prepare("SELECT title, view_scope, status, series, is_list FROM courses WHERE id = ?").bind(courseId).first<{ title: string; view_scope: string; status: string; series: string | null; is_list: number }>();
    if (!c || c.status !== "published") return;
    const me = ctx.session?.sub ?? null;
    const link = `/course/${courseId}`;
    const title = `${c.series || c.title}有新${what}`;
    let sent = 0;
    let merged = false;
    if (c.series && !isPrivate(c.view_scope)) {
      const recent = await ctx.db.prepare("SELECT 1 AS ok FROM notifications WHERE link = ? AND title = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes') LIMIT 1").bind(link, title).first();
      if (recent) merged = true;
      else sent = await notifySubscribers(ctx.db, seriesSubKey(c.series), title, `${c.title.slice(0, 80)}（${c.is_list === 1 ? "清單" : "課程"}）`, link, me);
    }
    // 課程類：報名＝訂閱，已報名的學員（已開通、審核中不算）也收到更新通知；系列訂閱者不重複通知（杜杜龍 2026-11-18）。
    let enrolledSent = 0;
    if (c.is_list !== 1 && !merged) enrolledSent = await notifyEnrolled(ctx.db, courseId, `${c.title.slice(0, 40)}有新${what}`, "你已報名這門課程，有新內容可以看了", link, me, c.series && !isPrivate(c.view_scope) ? seriesSubKey(c.series) : null);
    sent += enrolledSent;
    // 這門課程／清單自己的訂閱者（杜杜龍 2026-11-18）：已經以系列訂閱者或已報名學員身分收過通知的人不重複；30 分鐘內同一類型只通知一次。
    if (!merged && !isPrivate(c.view_scope)) {
      const ctitle = `${c.title.slice(0, 40)}有新${what}`;
      const recent = await ctx.db.prepare("SELECT 1 AS ok FROM notifications WHERE link = ? AND title = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes') LIMIT 1").bind(link, ctitle).first();
      if (!recent) {
        const { results } = await ctx.db
          .prepare("SELECT member_sub FROM center_subscriptions WHERE center_key = ?1 AND (?2 IS NULL OR member_sub NOT IN (SELECT member_sub FROM center_subscriptions WHERE center_key = ?2)) AND member_sub NOT IN (SELECT member_sub FROM enrollments WHERE course_id = ?3)")
          .bind(courseSubKey(courseId), c.series && !isPrivate(c.view_scope) ? seriesSubKey(c.series) : null, courseId)
          .all<{ member_sub: string }>();
        const subs = results.filter((r) => r.member_sub !== me);
        for (let i = 0; i < subs.length; i += 40) await ctx.db.batch(subs.slice(i, i + 40).map((r) => notify(ctx.db, { sub: r.member_sub }, ctitle, `${c.is_list === 1 ? "清單" : "課程"}有新內容可以看了`, link)));
        sent += subs.length;
      }
    }
    if (me) {
      // 給操作者自己的「已送出」回報也合併（杜杜龍 2026-11-24：一次傳 40 張照片＝40 則通知）：30 分鐘內同一份課程只留一則，更新次數並重新標為未讀。
      const selfTitle = `已送出「新${what}」通知`;
      const prev = await ctx.db.prepare("SELECT id, body FROM notifications WHERE recipient_sub = ? AND title = ? AND link = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes') ORDER BY created_at DESC LIMIT 1").bind(me, selfTitle, link).first<{ id: string; body: string }>();
      if (prev) {
        const n = Number(/共新增 (\d+) 次/.exec(prev.body)?.[1] ?? 1) + 1;
        const base = prev.body.replace(/（30 分鐘內共新增 \d+ 次[^）]*）$/, "");
        await ctx.db.prepare("UPDATE notifications SET body = ?, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), read_at = NULL WHERE id = ?").bind(`${base}（30 分鐘內共新增 ${n} 次，已合併成一則通知）`.slice(0, 300), prev.id).run();
      } else await notify(ctx.db, { sub: me }, selfTitle, `${c.title.slice(0, 80)}（${merged ? "30 分鐘內已通知過，這次合併不重複發送" : `通知了 ${sent} 位系列訂閱者`}）`, link).run();
    }
  } catch {
    /* 通知失敗不影響新增 */
  }
}

/** 通知某門課已開通報名的學員（報名＝訂閱更新）。except＝不通知的人；skipSubKey＝已經以訂閱者身分收過通知的人不重複。 */
export async function notifyEnrolled(db: D1Database, courseId: string, title: string, body: string, link: string, except: string | null, skipSubKey: string | null): Promise<number> {
  const { results } = await db.prepare("SELECT member_sub FROM enrollments WHERE course_id = ? AND (? IS NULL OR member_sub NOT IN (SELECT member_sub FROM center_subscriptions WHERE center_key = ?))").bind(courseId, skipSubKey, skipSubKey).all<{ member_sub: string }>();
  const subs = results.filter((r) => r.member_sub !== except);
  for (let i = 0; i < subs.length; i += 40) await db.batch(subs.slice(i, i + 40).map((r) => notify(db, { sub: r.member_sub }, title, body, link)));
  return subs.length;
}

/** 通知某個中心／系列的所有訂閱者（站內通知；推播由通知機制自動處理）。except＝不重複通知的人（上架者自己，另外收確認通知）；回傳通知人數。 */
export async function notifySubscribers(db: D1Database, key: string, title: string, body: string, link: string, except: string | null = null): Promise<number> {
  const { results } = await db.prepare("SELECT member_sub FROM center_subscriptions WHERE center_key = ?").bind(key).all<{ member_sub: string }>();
  const subs = results.filter((r) => r.member_sub !== except);
  for (let i = 0; i < subs.length; i += 40) await db.batch(subs.slice(i, i + 40).map((r) => notify(db, { sub: r.member_sub }, title, body, link)));
  return subs.length;
}

export const usageHits = new Map<string, { t: number; n: number }>();
export async function bumpView(db: D1Database, kind: "center" | "series" | "course", key: string): Promise<number> {
  const row = await db.prepare("INSERT INTO page_views (kind, key, total) VALUES (?, ?, 1) ON CONFLICT(kind, key) DO UPDATE SET total = total + 1 RETURNING total").bind(kind, key).first<{ total: number }>();
  return row?.total ?? 0;
}
/** 即時縮圖：輸出格式、設定簽名（改設定後舊快取自然失效）、送給 Cloudflare 的參數（只送非預設值）。 */
// 格式不再依瀏覽器 Accept 變化（杜杜龍 2026-11-20 回報 Android 長按下載圖片後該圖變空白）：同一個網址永遠同一種格式，不用 Vary: Accept，瀏覽器快取才不會被不同請求搞混。auto＝JPEG（相容性最好；杜杜龍 2026-11-20 Android 手機顯示 WebP 縮圖會整片空白）。
export const thumbFormat = (f: ThumbSettings["format"]): "avif" | "webp" | "jpeg" | "png" => (f === "auto" ? "jpeg" : f);
export const thumbSig = (t: ThumbSettings): string => {
  let h = 5381;
  for (const ch of JSON.stringify({ ...t, enabled: undefined })) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
};
export function thumbTransform(t: ThumbSettings, w: number): Record<string, unknown> {
  const o: Record<string, unknown> = { width: w, fit: t.fit };
  if (t.height > 0) o.height = Math.round(w * t.height);
  if (t.gravity !== "auto") o.gravity = t.gravity;
  if (t.rotate) o.rotate = t.rotate;
  if (t.flip) o.flip = t.flip === "hv" ? "hv" : t.flip;
  if (t.blur) o.blur = t.blur;
  if (t.sharpen) o.sharpen = t.sharpen;
  if (t.brightness !== 1) o.brightness = t.brightness;
  if (t.contrast !== 1) o.contrast = t.contrast;
  if (t.gamma !== 1) o.gamma = t.gamma;
  if (t.saturation !== 1) o.saturation = t.saturation;
  if (t.background) o.background = t.background;
  if (t.trim) o.trim = { top: t.trim, right: t.trim, bottom: t.trim, left: t.trim };
  if (t.borderWidth) o.border = { color: t.borderColor, width: t.borderWidth };
  return o;
}
export const thumbOutput = (t: ThumbSettings): Record<string, unknown> => ({ quality: t.qualityLevel || t.quality, ...(t.anim ? {} : { anim: false }), ...(t.metadata !== "none" ? { metadata: t.metadata } : {}) });
/** YouTube 教材沒有指定封面時的預設縮圖（杜杜龍 2026-11-25 全網新規則，取代 2026-11-22「完全移除 YouTube 抓封面」）：用 YouTube 自己的 16:9 縮圖。 */
export const ytThumbOf = (type: string | null | undefined, ref: string | null | undefined) => (type === "youtube" && ref ? `https://i.ytimg.com/vi/${encodeURIComponent(ref)}/mqdefault.jpg` : null);
export const pubUrl = (key: string, v: number) => `/api/v2/media/pub?k=${encodeURIComponent(key)}&v=${v}`;
export const cleanAnnouncement = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 120) : "");
export const ART_TYPES = new Set(["president", "sound"]);

/** 編輯某門課的 EDM／封面：要有這門課的「修改」權限。 */
export async function requireCourseArt(ctx: Ctx, _s: Session, courseId: string): Promise<void> {
  await requireCourseManager(ctx, courseId);
}

/** 取得課程的管理權限；need＝要的權限（預設「修改」）。 */
export async function courseRightsFor(ctx: Ctx, courseId: string): Promise<{ s: Session; can: CourseCan; rights: Rights }> {
  const s = requireMember(ctx);
  const rights = await rightsOf(ctx);
  if (!rights.any) fail(403, "forbidden", "需要課程管理權限");
  const c = await ctx.db.prepare("SELECT host_center_key, created_by_sub FROM courses WHERE id = ?").bind(courseId).first<{ host_center_key: string | null; created_by_sub: string }>();
  if (!c) return fail(404, "not_found", "找不到這門課程");
  return { s, can: courseCan(rights, s, c), rights };
}

/** 課程「修改」權限：總部不限；同中心的會長、音控；小編自己新增的課程，或有「修改別人」權限。 */
export async function requireCourseManager(ctx: Ctx, courseId: string): Promise<Session> {
  const { s, can } = await courseRightsFor(ctx, courseId);
  if (!can.edit) fail(403, "forbidden", "沒有修改這門課程的權限（只能管理主辦單位是自己中心、而且有權限的課程）");
  if (ctx.req.method !== "GET") ctx.touched = courseId; // 成功後記下最後修改者
  return s;
}
export async function managerVia(ctx: Ctx, sql: string, id: string, what: string): Promise<Session> {
  const row = await ctx.db.prepare(sql).bind(id).first<{ course_id: string }>();
  if (!row) return fail(404, "not_found", `找不到這個${what}`);
  return requireCourseManager(ctx, row.course_id);
}
/** 同步設定的管理權：超級管理員，或有該設定所屬課程修改權限的人（杜杜龍 2026-11-23：課程頁也能匯入、管理 YouTube 播放清單）。 */
export async function requireSyncManager(ctx: Ctx, syncId: string): Promise<Session> {
  const s = requireMember(ctx);
  if (s.roles.includes("super_admin")) return s;
  return managerVia(ctx, "SELECT course_id FROM youtube_syncs WHERE id = ?", syncId, "同步設定");
}
/** 雲端資料夾同步的管理權：超級管理員，或有該設定所屬課程修改權限的人（杜杜龍 2026-11-26：課程頁「新增教材」貼資料夾連結也能加入同步）。 */
export async function requireDriveSyncManager(ctx: Ctx, syncId: string): Promise<Session> {
  const s = requireMember(ctx);
  if (s.roles.includes("super_admin")) return s;
  return managerVia(ctx, "SELECT course_id FROM drive_syncs WHERE id = ?", syncId, "同步設定");
}
export const requireLessonManager = (ctx: Ctx, id: string) => managerVia(ctx, "SELECT course_id FROM lessons WHERE id = ?", id, "章節");
/** 可以新增課程的人：總部、有中心的會長與音控、有「新增」權限的小編。 */
export async function requireCourseCreator(ctx: Ctx): Promise<Session> {
  const s = requireMember(ctx);
  if (!canCreateCourse(await rightsOf(ctx))) fail(403, "forbidden", "沒有新增課程的權限");
  return s;
}
/** 有任何課程管理權限（看管理清單、選項）。 */
export async function requireCourseStaff(ctx: Ctx): Promise<Session> {
  const s = requireMember(ctx);
  if (!(await rightsOf(ctx)).any) fail(403, "forbidden", "需要課程管理權限");
  return s;
}

/** 記下最後修改者（章節、圖片等修改也算），顯示在編輯模式的進階設定最下方。 */
export const touchCourse = (db: D1Database, courseId: string, s: Session) => db.prepare("UPDATE courses SET edited_by_name = ?, edited_at = ? WHERE id = ?").bind(s.name.slice(0, 60), iso(), courseId);

/** 勾了「總結與銷售課程」的章節，名稱固定為這兩個字。 */
export const SUMMARY_TITLE = "總結";
export const cleanTitle = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80) : "");

/** 刪除章節／課程時一併清掉附件檔（資料列由 ON DELETE CASCADE 處理，須在刪資料前先取出鍵）。 */
export async function attachmentKeys(db: D1Database, where: "lesson_id" | "course_id", id: string): Promise<string[]> {
  const { results } = await db.prepare(`SELECT r2_key FROM lesson_attachments WHERE r2_key IS NOT NULL AND ${where} = ?`).bind(id).all<{ r2_key: string }>();
  return results.map((r) => r.r2_key);
}


// ---------- 教材檔案（杜杜龍 2026-11-18：一律存在行動大學的儲存空間 R2；來源可以是手機／電腦，或使用者自己的 Google 雲端硬碟） ----------
export const MB = 1024 * 1024;
/** 徹底刪除 R2 檔案：失敗重試一次，仍失敗記在日誌（不影響刪除教材本身）。 */
export async function deleteR2Files(env: Env, keys: (string | null | undefined)[]): Promise<void> {
  const bucket = env.MEDIA;
  if (!bucket) return;
  for (const k of keys) {
    if (!k) continue;
    for (let i = 0; i < 2; i++) {
      try {
        await bucket.delete(k);
        break;
      } catch (e) {
        if (i === 1) console.error("r2 delete failed", k, e instanceof Error ? e.message : "error");
      }
    }
  }
}

/**
 * 新教材放哪裡（杜杜龍 2026-11-20：最新的在最上面）：放在這份清單「第一個教材／區塊」的位置，原本的往後挪一格；
 * 還沒有任何教材就放最後（完整版課程影片永遠在最後）。回傳要放的順序位置與要先執行的搬移指令。
 */
export async function materialSlot(db: D1Database, courseId: string): Promise<{ at: number; pre: D1PreparedStatement[] }> {
  const first = await db.prepare("SELECT MIN(position) AS p FROM lessons WHERE course_id = ? AND is_full = 0 AND kind IN ('material', 'section')").bind(courseId).first<{ p: number | null }>();
  if (first?.p != null)
    return { at: first.p, pre: [db.prepare("UPDATE lessons SET position = -(position + 1) WHERE course_id = ? AND position >= ?").bind(courseId, first.p), db.prepare("UPDATE lessons SET position = -position WHERE course_id = ? AND position < 0").bind(courseId)] };
  const max = (await db.prepare("SELECT COALESCE(MAX(position), 0) AS m FROM lessons WHERE course_id = ?").bind(courseId).first<{ m: number }>())?.m ?? 0;
  const full = await db.prepare("SELECT id, position FROM lessons WHERE course_id = ? AND is_full = 1").bind(courseId).first<{ id: string; position: number }>();
  return full ? { at: full.position, pre: [db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(max + 1, full.id)] } : { at: max + 1, pre: [] };
}

/** 把已存進 R2 的檔案建成一個「其他教材」（放在完整版課程影片之前），並通知訂閱者。回傳教材編號。 */
export async function createFileMaterial(ctx: Ctx, admin: Session, courseId: string, f: { name: string; key: string; size: number; contentType: string; attType: AttachmentType; audit: string }): Promise<string> {
  const course = await ctx.db.prepare("SELECT (SELECT COALESCE(MAX(position), 0) FROM lessons WHERE course_id = c.id) AS maxpos FROM courses c WHERE c.id = ?").bind(courseId).first<{ maxpos: number }>();
  if (!course) return fail(404, "not_found", "找不到這門課程");
  const id = `${courseId}-${randomId(6)}`;
  const slot = await materialSlot(ctx.db, courseId);
  const title = cleanTitle(f.name.replace(/\.[^.]+$/, "")) || "檔案";
  await ctx.db.batch([
    ...slot.pre,
    ctx.db.prepare("INSERT INTO lessons (id, course_id, position, title, sharer, sharer_rank, sharer_title, duration_minutes, media_type, event_date, auto_cover, kind) VALUES (?, ?, ?, ?, '', '', '', 0, 'demo', NULL, 0, 'material')").bind(id, courseId, slot.at, title),
    ctx.db.prepare("INSERT INTO lesson_attachments (id, lesson_id, course_id, name, r2_key, size, content_type, kind, att_type, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'file', ?, ?)").bind(crypto.randomUUID(), id, courseId, f.name, f.key, f.size, f.contentType, f.attType, admin.sub),
    audit(ctx.db, admin.sub, f.audit, "lesson", id, `${f.attType}:${f.name}:${f.size}`),
  ]);
  await notifyNewContent(ctx, courseId, "教材");
  return id;
}

export async function lessonOf(ctx: Ctx, courseId: string, lessonId: string) {
  // 連結區塊（品牌資訊卡）裡的項目實際屬於另一份清單：回傳的 course_id 一律是真正的所屬清單。
  const lesson = await ctx.db
    .prepare(
      "SELECT l.id, l.course_id, l.media_type, l.media_ref, l.start_seconds, l.end_seconds FROM lessons l WHERE l.id = ? AND (l.course_id = ? OR EXISTS (SELECT 1 FROM lessons k JOIN lessons s ON s.id = k.link_block_id WHERE k.course_id = ? AND s.course_id = l.course_id))",
    )
    .bind(lessonId, courseId, courseId)
    .first<{ id: string; course_id: string; media_type: MediaType; media_ref: string | null; start_seconds: number | null; end_seconds: number | null }>();
  if (!lesson) return fail(404, "not_found", "找不到這個章節");
  return lesson;
}

// ---------- 報名與審核 ----------

export type OrderRow = {
  id: string;
  member_sub: string;
  status: Order["status"];
  total_twd: number;
  reject_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  member_name_snapshot: string;
  legal_name: string;
  pay_ref: string;
  center_key: string | null;
  center_label: string;
  hglobal: number;
  deferred: number;
  paid_twd: number | null;
  pay_method: Order["payMethod"];
  join_method: Order["joinMethod"];
  revoked_at: string | null;
};
export const ORDER_SELECT = "SELECT o.id, o.member_sub, o.status, o.total_twd, o.reject_reason, o.created_at, o.reviewed_at, o.member_name_snapshot, o.legal_name, o.pay_ref, o.center_key, o.center_label, o.hglobal, o.deferred, o.paid_twd, o.pay_method, o.join_method, o.revoked_at FROM orders o";

export async function hydrateOrders(db: D1Database, rows: OrderRow[]): Promise<Order[]> {
  if (!rows.length) return [];
  const { results } = await db
    .prepare(`SELECT i.order_id, i.course_id, i.title_snapshot, i.price_twd, c.series, c.event_start, c.event_end, c.location, c.location_none, c.is_online FROM order_items i LEFT JOIN courses c ON c.id = i.course_id WHERE i.order_id IN (${rows.map(() => "?").join(",")})`)
    .bind(...rows.map((r) => r.id))
    .all<{ order_id: string; course_id: string; title_snapshot: string; price_twd: number; series: string | null; event_start: string | null; event_end: string | null; location: string | null; location_none: number | null; is_online: number | null }>();
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    deferred: r.status === "pending" && r.deferred === 1,
    revoked: !!r.revoked_at,
    totalTwd: r.total_twd,
    paidTwd: r.paid_twd,
    payMethod: r.pay_method,
    joinMethod: r.join_method ?? "",
    rejectReason: r.reject_reason,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    memberName: r.member_name_snapshot,
    legalName: r.legal_name || null,
    payRef: r.pay_ref || null,
    memberSub: r.member_sub,
    centerLabel: r.center_label,
    hglobal: r.hglobal === 1,
    items: results
      .filter((i) => i.order_id === r.id)
      .map((i) => ({
        courseId: i.course_id,
        title: i.title_snapshot,
        priceTwd: i.price_twd,
        series: i.series ?? "",
        eventStart: i.event_start,
        eventEnd: i.event_end,
        place: i.is_online === 1 ? "線上課程" : i.location_none === 1 || !i.location ? null : i.location,
      })),
  }));
}

/**
 * 這位登入者的審核範圍：all＝全站（超級管理員、秘書）；center＝會長的中心；groups＝所屬審核群組與負責的中心（''＝全部中心）；
 * courses＝課程「費用與審核」直接指定的審核人員，或指定身份（主辦中心的會長／音控／小編）取得的課程（centerKey 非空＝只限該中心學員的報名）。
 */
export type ReviewScope = { all: boolean; center: string | null; groups: { groupId: string; centerKey: string }[]; courses: { courseId: string; centerKey: string }[] };
export async function reviewScope(ctx: Ctx, s: Session): Promise<ReviewScope> {
  if (s.role === "admin") return { all: true, center: null, groups: [], courses: [] };
  const [g, direct, eds, rc] = await ctx.db.batch([
    ctx.db.prepare("SELECT DISTINCT group_id, center_key FROM review_group_members WHERE member_sub = ?").bind(s.sub),
    ctx.db.prepare("SELECT course_id FROM course_reviewers WHERE member_sub = ?").bind(s.sub),
    ctx.db.prepare("SELECT center_key FROM course_editors WHERE member_sub = ?").bind(s.sub),
    ctx.db.prepare("SELECT id, host_center_key, review_roles FROM courses WHERE review_roles <> ''"),
  ]);
  const courses = (direct.results as { course_id: string }[]).map((r) => ({ courseId: r.course_id, centerKey: "" }));
  const editorCenters = (eds.results as { center_key: string }[]).map((r) => r.center_key);
  for (const c of rc.results as { id: string; host_center_key: string | null; review_roles: string }[]) {
    for (const role of c.review_roles.split(",")) {
      const centers = role === "editor" ? editorCenters : (role === "president" || role === "sound") && s.roles.includes(role) && s.center ? [s.center.key] : [];
      for (const ck of centers) {
        if (c.host_center_key) {
          if (c.host_center_key === ck) courses.push({ courseId: c.id, centerKey: "" });
        } else courses.push({ courseId: c.id, centerKey: ck }); // 總部主辦的課：只審核自己中心學員的報名
      }
    }
  }
  return { all: false, center: s.roles.includes("president") ? (s.center?.key ?? null) : null, groups: (g.results as { group_id: string; center_key: string }[]).map((r) => ({ groupId: r.group_id, centerKey: r.center_key })), courses };
}
export const hasScope = (sc: ReviewScope) => sc.all || !!sc.center || sc.groups.length > 0 || sc.courses.length > 0;

/** 審核範圍的 SQL 條件（套用在 orders o）。 */
export function scopeSql(sc: ReviewScope): { sql: string; args: unknown[] } {
  if (sc.all) return { sql: "1 = 1", args: [] };
  const parts: string[] = [];
  const args: unknown[] = [];
  if (sc.center) {
    parts.push("o.center_key = ?");
    args.push(sc.center);
  }
  for (const g of sc.groups) {
    parts.push(
      `EXISTS (SELECT 1 FROM order_items i JOIN courses c ON c.id = i.course_id WHERE i.order_id = o.id AND c.review_group_id = ?)${g.centerKey ? " AND o.center_key = ?" : ""}`,
    );
    args.push(g.groupId, ...(g.centerKey ? [g.centerKey] : []));
  }
  for (const c of sc.courses) {
    parts.push(`EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.course_id = ?)${c.centerKey ? " AND o.center_key = ?" : ""}`);
    args.push(c.courseId, ...(c.centerKey ? [c.centerKey] : []));
  }
  return { sql: parts.length ? `(${parts.map((p) => `(${p})`).join(" OR ")})` : "1 = 0", args };
}

export async function canReviewOrder(ctx: Ctx, s: Session, orderId: string): Promise<boolean> {
  const sc = await reviewScope(ctx, s);
  if (!hasScope(sc)) return false;
  const w = scopeSql(sc);
  return !!(await ctx.db.prepare(`SELECT 1 AS ok FROM orders o WHERE o.id = ? AND ${w.sql}`).bind(orderId, ...w.args).first());
}

export function titleOf(s: Session, duty?: string): string {
  const labels: Record<string, string> = { super_admin: "超級管理員", secretary: "總部秘書", president: "會長", register: "報名窗口", collect: "收費窗口", review: "審核員" };
  const role = ["super_admin", "secretary", "president"].find((r) => s.roles.includes(r));
  return labels[role ?? duty ?? ""] ?? (s.role === "admin" ? "管理員" : "");
}

export function event(db: D1Database, orderId: string, actor: { sub: string; name: string; title: string }, action: string, x: { reason?: string | null; message?: string; note?: string } = {}): D1PreparedStatement {
  return db
    .prepare("INSERT INTO order_events (id, order_id, actor_sub, actor_name, actor_title, action, reason_code, message, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), orderId, actor.sub, actor.name, actor.title, action, x.reason ?? null, x.message ?? "", x.note ?? "", iso());
}

/** 付費報名要通知誰：同中心的群組成員＋該中心會長；非寰宇、沒有中心或該中心沒有窗口時改通知總部（秘書、超級管理員）。 */
export async function reviewerNotices(ctx: Ctx, o: { id: string; centerKey: string | null; hglobal: boolean; groupId: string | null; courseId?: string | null }, title: string, body: string): Promise<D1PreparedStatement[]> {
  const link = `/admin/orders/${o.id}`;
  const out: D1PreparedStatement[] = [];
  let desk: string[] = [];
  // 課程直接指定的審核人員也收到通知。
  if (o.courseId) desk.push(...(await ctx.db.prepare("SELECT member_sub FROM course_reviewers WHERE course_id = ?").bind(o.courseId).all<{ member_sub: string }>()).results.map((r) => r.member_sub));
  if (o.groupId) {
    const { results } = await ctx.db
      .prepare("SELECT DISTINCT member_sub FROM review_group_members WHERE group_id = ? AND (center_key = '' OR center_key = ?)")
      .bind(o.groupId, o.centerKey ?? "\u0000")
      .all<{ member_sub: string }>();
    desk = [...new Set([...desk, ...results.map((r) => r.member_sub)])];
  }
  for (const sub of desk) out.push(notify(ctx.db, { sub }, title, body, link));
  if (o.hglobal && o.centerKey) out.push(notify(ctx.db, { role: "president", centerKey: o.centerKey }, title, body, link));
  if (!o.hglobal || !o.centerKey || !desk.length) out.push(notify(ctx.db, { role: "admin" }, o.hglobal ? `${title}（該中心尚未設定窗口）` : `${title}（非寰宇系統學員）`, body, link));
  return out;
}

export const METHOD_LABEL: Record<PaymentMethodKey, string> = { cash: "現金", linepay: "LINE Pay", transfer: "網銀轉帳", friend: "託朋友代付" };

/** 學員回報繳費方式（現金／LINE Pay／網銀轉帳／託朋友代付），可送出多次；通知審核人員核對。 */
export async function reportPayment(ctx: Ctx, orderId: string, body: Record<string, unknown>): Promise<Order> {
  const s = requireMember(ctx);
  const o = await ctx.db
    .prepare("SELECT o.id, o.member_sub, o.status, o.center_key, o.hglobal, o.total_twd, (SELECT c.review_group_id FROM order_items i JOIN courses c ON c.id = i.course_id WHERE i.order_id = o.id LIMIT 1) AS group_id, (SELECT i.course_id FROM order_items i WHERE i.order_id = o.id LIMIT 1) AS course_id, (SELECT i.title_snapshot FROM order_items i WHERE i.order_id = o.id LIMIT 1) AS title FROM orders o WHERE o.id = ?")
    .bind(orderId)
    .first<{ id: string; member_sub: string; status: string; center_key: string | null; hglobal: number; total_twd: number; group_id: string | null; course_id: string | null; title: string | null }>();
  if (!o || o.member_sub !== s.sub) return fail(404, "not_found", "找不到這筆報名");
  if (o.status !== "pending") fail(409, "not_pending", "這筆報名不在待審核狀態，不需要回報繳費");
  const method = (["cash", "linepay", "transfer", "friend"] as const).find((m) => m === body.method) ?? fail(400, "invalid_method", "請選擇繳費方式");
  const iso8601 = (v: unknown, label: string): string => {
    const t = typeof v === "string" ? Date.parse(v) : NaN;
    return Number.isNaN(t) ? fail(400, "invalid_time", `請填寫${label}`) : new Date(t).toISOString();
  };
  let last5: string | null = null;
  let friendName: string | null = null;
  let paidAt: string | null = null;
  if (method === "transfer") {
    last5 = typeof body.last5 === "string" && /^\d{5}$/.test(body.last5.trim()) ? body.last5.trim() : fail(400, "invalid_last5", "請填寫轉出帳號末五碼（5 位數字）");
    paidAt = iso8601(body.paidAt, "轉出日期時間");
  } else if (method === "friend") {
    friendName = text(body.friendName, 30) || fail(400, "invalid_friend", "請填寫朋友的名字");
  } else if (method === "linepay") {
    paidAt = iso8601(body.paidAt, "LINE Pay 的日期時間");
  }
  const count = await ctx.db.prepare("SELECT COUNT(*) AS n FROM order_payments WHERE order_id = ?").bind(orderId).first<{ n: number }>();
  if ((count?.n ?? 0) >= 10) fail(429, "too_many", "回報次數太多了，請聯絡報名窗口");
  const id = crypto.randomUUID();
  const detail = [METHOD_LABEL[method], last5 ? `末五碼 ${last5}` : "", friendName ? `朋友 ${friendName}` : "", paidAt ? `時間 ${paidAt.slice(0, 16).replace("T", " ")}（UTC）` : ""].filter(Boolean).join("｜");
  await ctx.db.batch([
    ctx.db.prepare("INSERT INTO order_payments (id, order_id, method, last5, friend_name, paid_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, orderId, method, last5, friendName, paidAt),
    audit(ctx.db, s.sub, "order.payment_report", "order", orderId, detail),
    ...(await reviewerNotices(ctx, { id: orderId, centerKey: o.center_key, hglobal: o.hglobal === 1, groupId: o.group_id, courseId: o.course_id }, "學員回報了繳費方式", `${o.title ?? ""}｜${detail}`)),
  ]);
  return orderDetail(ctx, orderId);
}

export type RegItem = { courseId: string };
/** 會員自己取消報名：審核中的報名、或免費自動開通的報名都可以反悔取消；已繳費（含 VIP 免繳費）開通的要聯絡窗口。 */
export async function cancelOrder(ctx: Ctx, orderId: string): Promise<{ ok: true }> {
  const s = requireMember(ctx);
  const o = await ctx.db.prepare("SELECT id, member_sub, status, pay_method, join_method FROM orders WHERE id = ?").bind(orderId).first<{ id: string; member_sub: string; status: string; pay_method: string | null; join_method: string }>();
  if (!o || o.member_sub !== s.sub) return fail(404, "not_found", "找不到這筆報名");
  const free = o.status === "opened" && (o.pay_method === "free" || o.join_method === "invite");
  if (o.status !== "pending" && !free) fail(409, "not_cancellable", o.status === "opened" ? "已繳費開通的報名無法自行取消，請聯絡報名窗口" : "這筆報名已退回，不需要取消");
  await ctx.db.batch([
    ctx.db.prepare("DELETE FROM notifications WHERE (link = ?1 OR link = ?2)").bind(`/orders/${orderId}`, `/admin/orders/${orderId}`),
    ctx.db.prepare("DELETE FROM enrollments WHERE source_order_id = ?").bind(orderId),
    ctx.db.prepare("DELETE FROM orders WHERE id = ?").bind(orderId),
    audit(ctx.db, s.sub, free ? "order.cancel_free" : "order.cancel", "order", orderId),
  ]);
  return { ok: true };
}


// ---------- 報名名單（杜杜龍 2026-11-20）：課程設定第七項；有審核權限的人都能看、都能移除學員 ----------
export type RosterAccess = { s: Session; w: { sql: string; args: unknown[] } };
/** 能看報名名單的人：超級管理員與有課程編輯權的人看全部；其他有審核權限的人只看自己審核範圍內的報名。 */
export async function rosterAccess(ctx: Ctx, courseId: string): Promise<RosterAccess> {
  const s = requireMember(ctx);
  const c = await ctx.db.prepare("SELECT host_center_key, created_by_sub FROM courses WHERE id = ?").bind(courseId).first<{ host_center_key: string | null; created_by_sub: string }>();
  if (!c) return fail(404, "not_found", "找不到這門課程");
  const rights = await rightsOf(ctx);
  if (s.role === "admin" || (rights.any && courseCan(rights, s, c).edit)) return { s, w: { sql: "1 = 1", args: [] } };
  const sc = await reviewScope(ctx, s);
  if (!hasScope(sc)) fail(403, "forbidden", "只有課程管理者與審核人員可以看報名名單");
  return { s, w: scopeSql(sc) };
}
/** 每位學員只列最新的一筆報名。 */
export const ROSTER_LATEST = "o.id = (SELECT o2.id FROM orders o2 JOIN order_items i2 ON i2.order_id = o2.id WHERE i2.course_id = i.course_id AND o2.member_sub = o.member_sub ORDER BY o2.created_at DESC, o2.rowid DESC LIMIT 1)";
export type RosterDb = { id: string; member_sub: string; member_name_snapshot: string; center_label: string; status: "opened" | "pending" | "rejected"; total_twd: number; join_method: string; created_at: string; revoked_at: string | null };
export const rosterMethod = (r: RosterDb): RosterRow["method"] => (r.join_method === "batch" ? "batch" : r.join_method === "invite" ? "invite" : r.join_method === "invite_request" ? "invite_request" : r.total_twd > 0 ? "paid" : "free");

export async function rosterRows(ctx: Ctx, courseId: string, a: RosterAccess, opts: { filter: string; q: string; limit: number; offset: number }): Promise<{ rows: (RosterDb)[]; total: number; counts: Roster["counts"] }> {
  const base = `FROM orders o JOIN order_items i ON i.order_id = o.id WHERE i.course_id = ? AND ${ROSTER_LATEST} AND ${a.w.sql}`;
  const baseArgs = [courseId, ...a.w.args];
  const q = opts.q.trim().slice(0, 30);
  const qSql = q ? " AND (o.member_name_snapshot LIKE ? ESCAPE '\\' OR o.center_label LIKE ? ESCAPE '\\')" : "";
  const qArgs = q ? [`%${q.replace(/[%_\\]/g, "\\$&")}%`, `%${q.replace(/[%_\\]/g, "\\$&")}%`] : [];
  const f = opts.filter === "pending" ? " AND o.status = 'pending'" : opts.filter === "invite" ? " AND o.join_method = 'invite'" : opts.filter === "opened" ? " AND o.status = 'opened'" : "";
  const [list, cnt] = await ctx.db.batch([
    ctx.db.prepare(`SELECT o.id, o.member_sub, o.member_name_snapshot, o.center_label, o.status, o.total_twd, o.join_method, o.created_at, o.revoked_at ${base}${qSql}${f} ORDER BY o.created_at DESC, o.rowid DESC LIMIT ? OFFSET ?`).bind(...baseArgs, ...qArgs, opts.limit, opts.offset),
    ctx.db.prepare(`SELECT COUNT(*) AS n_all, COALESCE(SUM(o.status = 'pending'), 0) AS n_pending, COALESCE(SUM(o.join_method = 'invite'), 0) AS n_invite, COALESCE(SUM(o.status = 'opened'), 0) AS n_opened ${base}${qSql}`).bind(...baseArgs, ...qArgs),
  ]);
  const c = (cnt.results[0] ?? {}) as { n_all: number; n_pending: number; n_invite: number; n_opened: number };
  const counts = { all: c.n_all ?? 0, pending: c.n_pending ?? 0, invite: c.n_invite ?? 0, opened: c.n_opened ?? 0 };
  const total = opts.filter === "pending" ? counts.pending : opts.filter === "invite" ? counts.invite : opts.filter === "opened" ? counts.opened : counts.all;
  return { rows: list.results as RosterDb[], total, counts };
}

export async function rosterOf(ctx: Ctx, courseId: string): Promise<Roster> {
  const a = await rosterAccess(ctx, courseId);
  const page = Math.max(1, Number(ctx.url.searchParams.get("page")) || 1);
  const pageSize = 50;
  const { rows, total, counts } = await rosterRows(ctx, courseId, a, { filter: ctx.url.searchParams.get("filter") ?? "all", q: ctx.url.searchParams.get("q") ?? "", limit: pageSize, offset: (page - 1) * pageSize });
  // 上手白金／鑽石只讀「這一頁」，由中央即時提供（不保存）。
  const uplines = await lookupUplines(ctx.env.CENTRAL_SERVICE_SECRET, rows.map((r) => r.member_sub)).catch(() => undefined);
  return {
    rows: rows.map((r): RosterRow => ({ orderId: r.id, name: r.member_name_snapshot, center: r.center_label, method: rosterMethod(r), status: r.revoked_at ? "rejected" : r.status, createdAt: r.created_at, uplinePlatinum: uplines?.get(r.member_sub)?.platinum ?? null, uplineDiamond: uplines?.get(r.member_sub)?.diamond ?? null })),
    total,
    counts,
    page,
    pageSize,
    uplineAvailable: !!uplines,
    ...(!uplines && rows.length ? { uplineError: lastUplineError || "原因不明" } : {}),
  };
}

export async function rosterCsv(ctx: Ctx, courseId: string): Promise<Response> {
  const a = await rosterAccess(ctx, courseId);
  const title = (await ctx.db.prepare("SELECT title FROM courses WHERE id = ?").bind(courseId).first<{ title: string }>())?.title ?? "";
  const { rows } = await rosterRows(ctx, courseId, a, { filter: "all", q: "", limit: 5000, offset: 0 });
  const uplines = await lookupUplines(ctx.env.CENTRAL_SERVICE_SECRET, rows.map((r) => r.member_sub)).catch(() => undefined);
  const methodLabel = { free: "免費報名", paid: "付費報名", invite: "邀請碼加入", invite_request: "無邀請碼申請", batch: "系列批次加入" } as const;
  const statusLabel = (r: RosterDb) => (r.revoked_at ? "已移除" : r.status === "opened" ? "已開通" : r.status === "rejected" ? "已退回" : "待審核");
  const lines = [
    ["姓名", "中心", "報名方式", "狀態", "報名時間", "上手白金", "上手鑽石"],
    ...rows.map((r) => [r.member_name_snapshot, r.center_label, methodLabel[rosterMethod(r)], statusLabel(r), r.created_at, uplines ? (uplines.get(r.member_sub)?.platinum ?? "") : "未提供", uplines ? (uplines.get(r.member_sub)?.diamond ?? "") : "未提供"]),
  ];
  await audit(ctx.db, a.s.sub, "roster.export", "course", courseId, String(rows.length)).run();
  return new Response("﻿" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="roster-${courseId}-${iso().slice(0, 10)}.csv"`, "cache-control": "no-store" },
  });
  void title;
}

/** 移除資格：已開通的取消開通、待審核的退回；通知學員；審核人員也可以做（杜杜龍 2026-11-20）。 */
export async function rosterRemove(ctx: Ctx, courseId: string, orderId: string): Promise<{ ok: true }> {
  const a = await rosterAccess(ctx, courseId);
  const row = await ctx.db
    .prepare(`SELECT o.id, o.member_sub, o.status FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.id = ? AND i.course_id = ? AND ${a.w.sql}`)
    .bind(orderId, courseId, ...a.w.args)
    .first<{ id: string; member_sub: string; status: string }>();
  if (!row) return fail(404, "not_found", "找不到這位學員的報名");
  if (row.status === "rejected") fail(409, "already_removed", "這筆報名已經是退回或移除的狀態");
  const title = (await ctx.db.prepare("SELECT title FROM courses WHERE id = ?").bind(courseId).first<{ title: string }>())?.title ?? "";
  const now = iso();
  await ctx.db.batch([
    ctx.db.prepare("UPDATE orders SET status = 'rejected', deferred = 0, reject_reason = '審核人員移除報名資格', reviewed_by_sub = ?, reviewed_at = ?, revoked_at = ? WHERE id = ?").bind(a.s.sub, now, now, orderId),
    ctx.db.prepare("DELETE FROM enrollments WHERE source_order_id = ?").bind(orderId),
    event(ctx.db, orderId, { sub: a.s.sub, name: a.s.name, title: titleOf(a.s, await dutyOf(ctx, a.s)) }, "revoke", { reason: null, message: "由報名名單移除資格", note: "" }),
    notify(ctx.db, { sub: row.member_sub }, "報名資格已被移除", `課程：${title}`, `/orders/${orderId}`),
    audit(ctx.db, a.s.sub, "roster.remove", "order", orderId, courseId),
  ]);
  return { ok: true };
}

/** 這位登入者能不能看這門課的報名名單（只用來決定要不要顯示入口；真正的權限在 rosterAccess）。 */
export async function canSeeRoster(ctx: Ctx, s: Session | null, row: { id: string; review_group_id: string | null }, manages: boolean): Promise<boolean> {
  if (!s) return false;
  if (manages || s.role === "admin") return true;
  const sc = await reviewScope(ctx, s);
  return sc.groups.some((g) => g.groupId === row.review_group_id) || sc.courses.some((c) => c.courseId === row.id);
}


// ---------- 系列「套用到全系列課程」（杜杜龍 2026-11-20）：系列只是設定範本，沒有報名鈕；只有超級管理員 ----------
export type SeriesCourseRow = { id: string; title: string; status: string; is_list: number };
export async function seriesCourses(ctx: Ctx, series: string, only?: unknown): Promise<SeriesCourseRow[]> {
  const { results } = await ctx.db.prepare("SELECT id, title, status, is_list FROM courses WHERE series = ? ORDER BY created_at").bind(series).all<SeriesCourseRow>();
  const ids = Array.isArray(only) ? new Set(only.filter((x): x is string => typeof x === "string")) : null;
  return results.filter((c) => !ids || ids.has(c.id));
}
export async function seriesApply(ctx: Ctx): Promise<SeriesApplyPlan | SeriesApplyResult> {
  requireSuperAdmin(ctx);
  const body = await readJson<{ series?: unknown; fields?: unknown; courseIds?: unknown; dry?: unknown }>(ctx.req);
  const series = typeof body.series === "string" && body.series.trim() ? body.series.trim() : fail(400, "invalid_series", "請指定系列");
  const raw = body.fields && typeof body.fields === "object" && !Array.isArray(body.fields) ? (body.fields as Record<string, unknown>) : fail(400, "no_fields", "請勾選要套用的欄位");
  const keys = Object.keys(raw);
  if (!keys.length) fail(400, "no_fields", "請勾選要套用的欄位");
  const bad = keys.find((k) => !SERIES_APPLY_FIELDS.includes(k));
  if (bad) fail(400, "invalid_field", `「${bad}」不能套用到全系列`);
  if (raw.status !== undefined && raw.status !== "draft" && raw.status !== "published") fail(400, "invalid_status", "上架狀態只能是上架或未上架");
  const courses = await seriesCourses(ctx, series, body.courseIds);
  if (!courses.length) fail(404, "empty_series", "這個系列沒有可以套用的課程");
  // 已經有人報名（含審核中）的課程：費用不被覆蓋。
  const marks = courses.map(() => "?").join(",");
  const { results: regs } = await ctx.db.prepare(`SELECT DISTINCT i.course_id FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status <> 'rejected' AND i.course_id IN (${marks})`).bind(...courses.map((c) => c.id)).all<{ course_id: string }>();
  const hasRegs = new Set(regs.map((r) => r.course_id));
  const plan: SeriesApplyPlan = {
    fields: keys,
    courses: courses.map((c) => {
      const skipped: { key: string; reason: string }[] = [];
      let apply = keys;
      if (c.status === "archived") {
        skipped.push(...keys.map((key) => ({ key, reason: "已下架封存" })));
        apply = [];
      } else if (hasRegs.has(c.id)) {
        for (const k of keys) if (SERIES_PRICE_FIELDS.includes(k)) skipped.push({ key: k, reason: "已有人報名，費用不覆蓋" });
        apply = keys.filter((k) => !SERIES_PRICE_FIELDS.includes(k));
      }
      return { id: c.id, title: c.title, apply, skipped };
    }),
  };
  if (body.dry === true) return plan;
  const result: SeriesApplyResult = { applied: 0, failed: [] };
  for (const c of plan.courses) {
    if (!c.apply.length) continue;
    try {
      await updateCourseWith(ctx, c.id, Object.fromEntries(c.apply.map((k) => [k, raw[k]])), true);
      result.applied++;
    } catch (e) {
      result.failed.push({ id: c.id, title: c.title, error: e instanceof HttpError ? e.message : "儲存失敗" });
    }
  }
  // 記下這個系列的範本：之後在這個系列新增課程，預設沿用（只記有成功套用的欄位值）。
  const cur = await ctx.db.prepare("SELECT template FROM series_settings WHERE series = ?").bind(series).first<{ template: string }>();
  let tpl: Record<string, unknown> = {};
  try {
    tpl = cur?.template ? (JSON.parse(cur.template) as Record<string, unknown>) : {};
  } catch {
    tpl = {};
  }
  await ctx.db.batch([
    ctx.db.prepare("INSERT OR IGNORE INTO series_settings (series) VALUES (?)").bind(series),
    ctx.db.prepare("UPDATE series_settings SET template = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE series = ?").bind(JSON.stringify({ ...tpl, ...raw }), series),
    audit(ctx.db, ctx.session!.sub, "series.apply", "series", series, `${keys.join(",")}｜${result.applied}門`),
  ]);
  return result;
}
/** 新增課程時，系列有範本就把沒填的欄位用範本補上（名稱、主講人這類每門課自己的資料不在範本裡）。 */
export async function withSeriesDefaults(ctx: Ctx, body: Record<string, unknown>): Promise<void> {
  const series = typeof body.series === "string" ? body.series.trim() : "";
  if (!series) return;
  const row = await ctx.db.prepare("SELECT template FROM series_settings WHERE series = ?").bind(series).first<{ template: string }>();
  if (!row?.template || row.template === "{}") return;
  let tpl: Record<string, unknown> = {};
  try {
    tpl = JSON.parse(row.template) as Record<string, unknown>;
  } catch {
    return;
  }
  for (const [k, v] of Object.entries(tpl)) if (SERIES_APPLY_FIELDS.includes(k) && body[k] === undefined) body[k] = v;
}
/** 第七項「報名名單」的套用：把某一門課的已開通學員，批次加入同系列的其他課程。 */
export async function seriesRosterJoin(ctx: Ctx): Promise<SeriesRosterPlan | { added: number }> {
  const s = requireSuperAdmin(ctx);
  const body = await readJson<{ series?: unknown; sourceCourseId?: unknown; courseIds?: unknown; dry?: unknown }>(ctx.req);
  const series = typeof body.series === "string" && body.series.trim() ? body.series.trim() : fail(400, "invalid_series", "請指定系列");
  const sourceId = typeof body.sourceCourseId === "string" ? body.sourceCourseId : fail(400, "no_source", "請選擇名單來源的課程");
  const all = await seriesCourses(ctx, series);
  const source = all.find((c) => c.id === sourceId) ?? fail(404, "not_found", "來源課程不在這個系列裡");
  const { results: members } = await ctx.db
    .prepare("SELECT e.member_sub, o.member_name_snapshot AS name, o.center_key, o.center_label, o.hglobal FROM enrollments e JOIN orders o ON o.id = e.source_order_id WHERE e.course_id = ?")
    .bind(sourceId)
    .all<{ member_sub: string; name: string; center_key: string | null; center_label: string; hglobal: number }>();
  const only = Array.isArray(body.courseIds) ? new Set(body.courseIds.filter((x): x is string => typeof x === "string")) : null;
  const targets = all.filter((c) => c.id !== sourceId && (!only || only.has(c.id)));
  const plan: SeriesRosterPlan = { source: { id: source.id, title: source.title, members: members.length }, targets: [], totalAdd: 0 };
  const toAdd = new Map<string, string[]>();
  for (const t of targets) {
    if (t.status === "archived") {
      plan.targets.push({ id: t.id, title: t.title, add: 0, already: 0, skipped: "已下架封存" });
      continue;
    }
    if (await ctx.db.prepare(`SELECT 1 AS x FROM courses WHERE id = ? AND ${MATERIAL_LIKE_SQL}`).bind(t.id).first()) {
      plan.targets.push({ id: t.id, title: t.title, add: 0, already: 0, skipped: "這張教材卡不需要報名" });
      continue;
    }
    const { results: have } = await ctx.db
      .prepare("SELECT member_sub FROM enrollments WHERE course_id = ? UNION SELECT o.member_sub FROM orders o JOIN order_items i ON i.order_id = o.id WHERE i.course_id = ? AND o.status = 'pending'")
      .bind(t.id, t.id)
      .all<{ member_sub: string }>();
    const haveSet = new Set(have.map((h) => h.member_sub));
    const add = members.filter((m) => !haveSet.has(m.member_sub)).map((m) => m.member_sub);
    toAdd.set(t.id, add);
    plan.targets.push({ id: t.id, title: t.title, add: add.length, already: members.length - add.length, skipped: null });
    plan.totalAdd += add.length;
  }
  if (body.dry === true) return plan;
  if (plan.totalAdd > 2000) fail(400, "too_many", "一次最多批次加入 2000 筆，請減少選取的課程");
  const byMember = new Map(members.map((m) => [m.member_sub, m]));
  const now = new Date();
  let added = 0;
  for (const t of targets) {
    const subs = toAdd.get(t.id) ?? [];
    const stmts: D1PreparedStatement[] = [];
    for (const sub of subs) {
      const m = byMember.get(sub)!;
      const id = orderId(now);
      stmts.push(
        ctx.db.prepare("INSERT INTO orders (id, member_sub, member_name_snapshot, status, total_twd, created_at, center_key, center_label, hglobal, paid_twd, pay_method, paid_at, legal_name, pay_ref, join_method) VALUES (?, ?, ?, 'opened', 0, ?, ?, ?, ?, 0, 'vip', ?, '', '', 'batch')").bind(id, sub, m.name, iso(now), m.center_key, m.center_label, m.hglobal, iso(now)),
        ctx.db.prepare("INSERT INTO order_items (order_id, course_id, title_snapshot, price_twd) VALUES (?, ?, ?, 0)").bind(id, t.id, t.title),
        ctx.db.prepare("INSERT OR IGNORE INTO enrollments (member_sub, course_id, source_order_id) VALUES (?, ?, ?)").bind(sub, t.id, id),
        notify(ctx.db, { sub }, "已加入課程", t.title, "/learning"),
      );
    }
    for (let i = 0; i < stmts.length; i += 60) await ctx.db.batch(stmts.slice(i, i + 60));
    added += subs.length;
  }
  await audit(ctx.db, s.sub, "series.roster_join", "series", series, `${source.title}｜${added}筆`).run();
  return { added };
}

export const INVITE_MAX_FAILS = 5;
export const INVITE_LOCK_MS = 600_000;
/** 檢查邀請碼：連續輸錯 5 次鎖 10 分鐘；輸對就清掉錯誤紀錄。不分大小寫、忽略前後空白（明碼，可以很簡單）。 */
export async function checkInviteCode(ctx: Ctx, sub: string, c: { id: string; invite_code: string }, code: string): Promise<void> {
  if (!c.invite_code) fail(400, "invite_no_code", "這門課沒有設定邀請碼，請按「無邀請碼」改由人工審核");
  const row = await ctx.db.prepare("SELECT fails, locked_until FROM invite_attempts WHERE member_sub = ? AND course_id = ?").bind(sub, c.id).first<{ fails: number; locked_until: string | null }>();
  const now = iso();
  if (row?.locked_until && row.locked_until > now) fail(429, "invite_locked", "邀請碼輸入錯誤太多次，請 10 分鐘後再試");
  if (code.toLowerCase() !== c.invite_code.toLowerCase()) {
    const fails = (row?.locked_until && row.locked_until <= now ? 0 : (row?.fails ?? 0)) + 1;
    const lock = fails >= INVITE_MAX_FAILS;
    await ctx.db.prepare("INSERT INTO invite_attempts (member_sub, course_id, fails, locked_until) VALUES (?, ?, ?, ?) ON CONFLICT(member_sub, course_id) DO UPDATE SET fails = excluded.fails, locked_until = excluded.locked_until").bind(sub, c.id, lock ? 0 : fails, lock ? new Date(Date.now() + INVITE_LOCK_MS).toISOString() : null).run();
    fail(lock ? 429 : 403, lock ? "invite_locked" : "invite_wrong", lock ? "邀請碼連續輸入錯誤 5 次，已暫停 10 分鐘" : `邀請碼不正確（還可以再試 ${INVITE_MAX_FAILS - fails} 次）`);
  }
  if (row) await ctx.db.prepare("DELETE FROM invite_attempts WHERE member_sub = ? AND course_id = ?").bind(sub, c.id).run();
}

export async function createOrders(ctx: Ctx, body: { courseIds?: unknown; items?: unknown; inviteCode?: unknown }, quiet = false): Promise<Order[]> {
  const s = requireMember(ctx);
  const raw: RegItem[] = [
    ...(Array.isArray(body.courseIds) ? body.courseIds.filter((x): x is string => typeof x === "string").map((courseId) => ({ courseId })) : []),
    ...(Array.isArray(body.items) ? (body.items as { courseId?: unknown }[]).filter((x) => typeof x?.courseId === "string").map((x) => ({ courseId: x.courseId as string })) : []),
  ];
  const items = [...new Map(raw.map((i) => [i.courseId, i])).values()];
  let legal: string | null = null;
  if (!items.length || items.length > 20) fail(400, "invalid_courses", "請選擇要報名的課程");
  const ids = [...new Set(items.map((i) => i.courseId))];
  const marks = ids.map(() => "?").join(",");
  const [{ results: courses }, rankMap, state] = await Promise.all([
    ctx.db
      .prepare(`SELECT id, title, price_twd, price_tba, diamond_free, early_bird, early_price_twd, early_until, min_rank_code, free_from, free_until, review_group_id, allow_president, invite_only, invite_code FROM courses WHERE status = 'published' AND id IN (${marks})`)
      .bind(...ids)
      .all<{ id: string; title: string; price_twd: number; price_tba: number; diamond_free: number; early_bird: number; early_price_twd: number | null; early_until: string | null; min_rank_code: string; free_from: string | null; free_until: string | null; review_group_id: string | null; allow_president: number; invite_only: number; invite_code: string }>(),
    ranks(ctx.db),
    memberCourseState(ctx.db, s.sub),
  ]);
  if (courses.length !== ids.length) fail(409, "unavailable", "課程已下架或不存在，請重新確認");
  {
    const { results: scopes } = await ctx.db.prepare(`SELECT id, view_scope FROM courses WHERE id IN (${marks})`).bind(...ids).all<{ id: string; view_scope: string }>();
    if (scopes.some((c) => !scopeAllows(c.view_scope, s))) fail(403, "not_visible", "這門課程不開放你報名");
    if ((await ctx.db.prepare(`SELECT 1 AS ok FROM courses WHERE ${MATERIAL_LIKE_SQL} AND id IN (${marks}) LIMIT 1`).bind(...ids).first())) fail(400, "list_no_enroll", "這張教材卡不需要報名，打開就能看");
  }
  if (courses.some((c) => c.price_tba === 1)) fail(409, "price_tba", "這門課程的費用尚未公布，暫不開放報名");
  const eligibility = await eligibilityFor(s, rankMap, [...courses.map((c) => c.min_rank_code), DIAMOND]);
  if (s.role !== "admin" && courses.some((c) => c.invite_only !== 1 && eligibility.get(c.min_rank_code) !== true && !byPresident(s, c))) fail(403, "rank_required", "此課程需要符合資格才能報名");

  const now = new Date();
  const statements: D1PreparedStatement[] = [];
  const created: string[] = [];
  const actor = { sub: s.sub, name: s.name, title: "學員" };
  const code = typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";
  for (const item of items) {
    const c = courses.find((x) => x.id === item.courseId)!;
    const key = c.id;
    // 指定邀請制（杜杜龍 2026-11-20）：輸入正確邀請碼＝免審核直接開通（金額 0）；沒有邀請碼＝一律人工審核（免費課程也要）。
    let joinMethod: Order["joinMethod"] = "";
    if (c.invite_only === 1) {
      if (code) {
        await checkInviteCode(ctx, s.sub, c, code);
        joinMethod = "invite";
      } else joinMethod = "invite_request";
    }
    const viaInvite = joinMethod === "invite";
    // 先前按了「無邀請碼」正在待審核，現在拿到邀請碼：撤掉待審核的那筆，直接用邀請碼加入。
    if (viaInvite && state.pending.has(key)) {
      const prev = await ctx.db.prepare("SELECT o.id FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.member_sub = ? AND i.course_id = ? AND o.status = 'pending' LIMIT 1").bind(s.sub, key).first<{ id: string }>();
      if (prev) statements.push(ctx.db.prepare("DELETE FROM notifications WHERE (link = ?1 OR link = ?2)").bind(`/orders/${prev.id}`, `/admin/orders/${prev.id}`), ctx.db.prepare("DELETE FROM orders WHERE id = ?").bind(prev.id));
    } else if (state.enrolled.has(key) || state.pending.has(key)) fail(409, "duplicate", "這門課程已報名（已開通或審核中），請勿重複報名");
    const listPrice = inFreeWindow(c, iso(now)) || (c.diamond_free === 1 && eligibility.get(DIAMOND) === true) ? 0 : earlyActive(c, iso(now)) ? (c.early_price_twd as number) : c.price_twd;
    const price = viaInvite ? 0 : listPrice;
    const auto = viaInvite || (listPrice === 0 && joinMethod === ""); // 立即開通：邀請碼加入，或一般免費課程
    if (listPrice > 0 && !viaInvite && ctx.platform !== "web") fail(403, "web_only", "付費課程請至網頁版報名");
    // 付費課程：對帳需要真實姓名，報名當下讀取會員中心的 legal_name 存成快照（免費課程、邀請碼加入不存）。
    if (listPrice > 0 && !viaInvite && legal === null) legal = s.kind === "central" ? await legalNameOf(s.token) : s.name;
    const id = orderId(now);
    const title = c.title;
    created.push(id);
    statements.push(
      ctx.db
        .prepare(
          "INSERT INTO orders (id, member_sub, member_name_snapshot, status, total_twd, created_at, center_key, center_label, hglobal, paid_twd, pay_method, paid_at, legal_name, pay_ref, join_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id, s.sub, s.name, auto ? "opened" : "pending", price, iso(now), s.center?.key ?? null, s.center?.label ?? "", s.hglobal ? 1 : 0, auto ? 0 : null, auto ? (viaInvite ? "vip" : "free") : null, auto ? iso(now) : null, auto || !legal ? "" : legal, !auto && price > 0 ? payRef() : "", joinMethod),
      ctx.db.prepare("INSERT INTO order_items (order_id, course_id, title_snapshot, price_twd) VALUES (?, ?, ?, ?)").bind(id, c.id, title, price),
      event(ctx.db, id, actor, "submit"),
      audit(ctx.db, s.sub, viaInvite ? "order.join_invite" : auto ? "order.register_free" : "order.register", "order", id, title),
    );
    if (auto) {
      // 立即開通；PRIMARY KEY 保證同一會員同一場只會開通一次（重複請求整批失敗）。
      statements.push(
        ctx.db.prepare("INSERT INTO enrollments (member_sub, course_id, source_order_id) VALUES (?, ?, ?)").bind(s.sub, c.id, id),
        ...(quiet ? [] : [notify(ctx.db, { sub: s.sub }, viaInvite ? "已透過邀請碼加入課程" : "課程已開通", title, "/learning")]),
        // 管理員（課程的審核窗口、會長、總部）收到「有人使用邀請碼加入」（杜杜龍 2026-11-20）。
        ...(viaInvite ? await reviewerNotices(ctx, { id, centerKey: s.center?.key ?? null, hglobal: s.hglobal, groupId: c.review_group_id, courseId: c.id }, "有人使用邀請碼加入課程", `${s.name}${s.center ? `（${s.center.label}）` : ""}｜${title}`) : []),
      );
    } else {
      statements.push(
        notify(ctx.db, { sub: s.sub }, "報名已送出，等待審核", title, `/orders/${id}`),
        ...(await reviewerNotices(ctx, { id, centerKey: s.center?.key ?? null, hglobal: s.hglobal, groupId: c.review_group_id, courseId: c.id }, "有新的報名待審核", price > 0 ? `${applicantLabel(legal, s.name)}｜${title}｜NT$${price.toLocaleString("en-US")}` : `${s.name}${s.center ? `（${s.center.label}）` : ""}｜${title}｜指定邀請制申請`)),
      );
    }
  }
  try {
    await ctx.db.batch(statements);
  } catch {
    fail(409, "duplicate", "這門課程已經報名過了");
  }
  const { results } = await ctx.db.prepare(`${ORDER_SELECT} WHERE o.id IN (${created.map(() => "?").join(",")})`).bind(...created).all<OrderRow>();
  return hydrateOrders(ctx.db, results);
}

/** 單筆報名明細：本人或有審核權限者可看；含操作紀錄（私人備註只給審核人員）與該中心的收費窗口。 */
export async function orderDetail(ctx: Ctx, id: string): Promise<Order> {
  const s = requireMember(ctx);
  const row = await ctx.db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).bind(id).first<OrderRow>();
  if (!row) return fail(404, "not_found", "找不到這筆報名");
  const reviewer = await canReviewOrder(ctx, s, id);
  if (row.member_sub !== s.sub && !reviewer) fail(404, "not_found", "找不到這筆報名");
  const [order] = await hydrateOrders(ctx.db, [row]);
  // 審核人員（不是本人）開啟明細會看到真實姓名：留下查看紀錄（只記誰、哪一筆，不記姓名內容）。
  if (reviewer && row.member_sub !== s.sub && row.legal_name) await audit(ctx.db, s.sub, "order.view_legal_name", "order", id).run().catch(() => undefined);
  const [events, collectors, reviewers, payments] = await Promise.all([
    ctx.db.prepare("SELECT id, actor_sub, actor_name, actor_title, action, reason_code, message, note, created_at FROM order_events WHERE order_id = ? ORDER BY created_at, rowid").bind(id).all<{
      id: string;
      actor_sub: string;
      actor_name: string;
      actor_title: string;
      action: OrderEvent["action"];
      reason_code: string | null;
      message: string;
      note: string;
      created_at: string;
    }>(),
    ctx.db
      .prepare(
        "SELECT DISTINCT m.member_name FROM review_group_members m JOIN courses c ON c.review_group_id = m.group_id JOIN order_items i ON i.course_id = c.id WHERE i.order_id = ? AND m.duty = 'collect' AND m.member_name <> '' AND (m.center_key = ? OR (m.center_key = '' AND NOT EXISTS (SELECT 1 FROM review_group_members x WHERE x.group_id = m.group_id AND x.duty = 'collect' AND x.center_key = ?)))",
      )
      .bind(id, row.center_key ?? "\u0000", row.center_key ?? "\u0000")
      .all<{ member_name: string }>(),
    ctx.db
      .prepare(
        "SELECT DISTINCT m.member_name FROM review_group_members m JOIN courses c ON c.review_group_id = m.group_id JOIN order_items i ON i.course_id = c.id WHERE i.order_id = ? AND m.duty = 'review' AND m.member_name <> '' AND (m.center_key = ? OR (m.center_key = '' AND NOT EXISTS (SELECT 1 FROM review_group_members x WHERE x.group_id = m.group_id AND x.duty = 'review' AND x.center_key = ?)))",
      )
      .bind(id, row.center_key ?? "\u0000", row.center_key ?? "\u0000")
      .all<{ member_name: string }>(),
    ctx.db.prepare("SELECT id, method, last5, friend_name, paid_at, created_at FROM order_payments WHERE order_id = ? ORDER BY created_at, rowid").bind(id).all<{ id: string; method: PaymentMethodKey; last5: string | null; friend_name: string | null; paid_at: string | null; created_at: string }>(),
  ]);
  return {
    ...order,
    events: events.results
      .filter((e) => reviewer || e.action !== "note")
      .map((e) => ({
        id: e.id,
        action: e.action,
        actorName: e.actor_name,
        actorTitle: e.actor_title,
        mine: e.actor_sub === s.sub,
        reason: e.reason_code ? (REVIEW_REASONS[e.reason_code as ReviewReason] ?? e.reason_code) : null,
        message: e.message,
        ...(reviewer ? { note: e.note } : {}),
        createdAt: e.created_at,
      })),
    collectors: collectors.results.map((c) => c.member_name),
    reviewers: reviewers.results.map((c) => c.member_name),
    payments: payments.results.map((p): PaymentReport => ({ id: p.id, method: p.method, last5: p.last5, friendName: p.friend_name, paidAt: p.paid_at, createdAt: p.created_at })),
    canReview: reviewer,
    canRevoke: s.role === "admin" && row.status === "opened" && row.total_twd > 0,
  };
}

/** 登入時記下是否為管理員／哪個中心的會長（寄給角色型通知時用來找收件人）。聯絡信箱不保存，寄信時才向中央查。 */
export async function syncContact(ctx: Ctx, s: Session): Promise<void> {
  const president = s.roles.includes("president") && s.center ? s.center.key : null;
  await ctx.db
    .prepare("INSERT INTO member_contacts (member_sub, is_admin, president_center_key) VALUES (?, ?, ?) ON CONFLICT(member_sub) DO UPDATE SET is_admin = excluded.is_admin, president_center_key = excluded.president_center_key")
    .bind(s.sub, s.role === "admin" ? 1 : 0, president)
    .run();
  // 超級管理員登入時順便向中央回報採用的串接版本（背景、每小時一次、失敗不影響）。
  if (s.kind === "central" && s.role === "admin") void reportIntegration(s.token).catch(() => undefined);
}

/** 會員的 Email 情境開關：存的是改過的項目，沒存的用預設（只有付費課程審核通知預設要寄）。 */
export function emailKindsOf(raw: string | null): Record<NoticeKind, boolean> {
  let saved: Record<string, unknown> = {};
  try {
    saved = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    saved = {};
  }
  return Object.fromEntries(NOTICE_KINDS.map((k) => [k.key, typeof saved[k.key] === "boolean" ? saved[k.key] : k.emailDefault])) as Record<NoticeKind, boolean>;
}

export async function contactSettings(ctx: Ctx, s: Session): Promise<NotificationSettings> {
  const row = await ctx.db.prepare("SELECT email, notify_email, email_kinds FROM member_contacts WHERE member_sub = ?").bind(s.sub).first<{ email: string | null; notify_email: number; email_kinds: string | null }>();
  // 中央會員：信箱只即時向中央查，不看本地；模擬會員（測試用）才用本地欄位。
  const email = s.kind === "central" ? ((await contactEmail(s.sub, s.token)) ?? null) : (row?.email ?? null);
  return { email, notifyEmail: (row?.notify_email ?? 1) === 1, emailKinds: emailKindsOf(row?.email_kinds ?? null), emailReady: !!ctx.env.EMAIL && !!ctx.env.EMAIL_FROM, source: s.kind === "central" ? "central" : "local" };
}

export async function dutyOf(ctx: Ctx, s: Session): Promise<string | undefined> {
  const r = await ctx.db.prepare("SELECT duty FROM review_group_members WHERE member_sub = ? LIMIT 1").bind(s.sub).first<{ duty: string }>();
  return r?.duty;
}

/** 審核：已繳費／VIP 免繳費／退回／延後再審／撤銷開通（撤銷限秘書與超級管理員）。 */
export async function reviewOrder(ctx: Ctx, id: string, body: Record<string, unknown>): Promise<Order> {
  const s = requireMember(ctx);
  if (ctx.platform !== "web") fail(403, "web_only", "報名審核請至網頁版辦理");
  const action = body.action as ReviewAction;
  if (!["paid", "vip", "reject", "defer", "revoke"].includes(action)) fail(400, "invalid_action", "審核動作不正確");
  const order = await ctx.db.prepare("SELECT id, member_sub, status, total_twd FROM orders WHERE id = ?").bind(id).first<{ id: string; member_sub: string; status: string; total_twd: number }>();
  if (!order || !(await canReviewOrder(ctx, s, id))) return fail(404, "not_found", "找不到這筆報名");
  if (action === "revoke") {
    if (s.role !== "admin") fail(403, "forbidden", "只有總部秘書與超級管理員可以撤銷開通");
    if (order.status !== "opened") fail(409, "not_opened", "這筆報名尚未開通");
  } else if (order.status !== "pending") fail(409, "already_reviewed", "這筆報名已審核過");

  const message = text(body.message, 500) ?? "";
  const note = text(body.note, 500) ?? "";
  const needsReason = action === "reject" || action === "defer" || action === "revoke";
  const code = typeof body.reasonCode === "string" && body.reasonCode in REVIEW_REASONS ? (body.reasonCode as ReviewReason) : null;
  if (needsReason && !code) fail(400, "reason_required", "請選擇原因");
  if (needsReason && code === "other" && !message) fail(400, "reason_required", "請填寫原因");
  const reasonText = code ? (code === "other" ? message : REVIEW_REASONS[code]) : null;
  const now = iso();
  const actor = { sub: s.sub, name: s.name, title: titleOf(s, await dutyOf(ctx, s)) };
  const by = `${actor.title ? `${actor.title} ` : ""}${actor.name}`;
  const statements: D1PreparedStatement[] = [];
  const guard = action === "revoke" ? "status = 'opened'" : "status = 'pending'";
  if (action === "paid" || action === "vip") {
    const method = action === "vip" ? "vip" : body.payMethod === "transfer" ? "transfer" : "cash";
    const paid = action === "vip" ? 0 : body.paidTwd === undefined ? order.total_twd : Number(body.paidTwd);
    if (!Number.isInteger(paid) || paid < 0 || paid > 10_000_000) fail(400, "invalid_amount", "實收金額不正確");
    statements.push(
      ctx.db
        .prepare(`UPDATE orders SET status = 'opened', deferred = 0, reject_reason = NULL, reviewed_by_sub = ?, reviewed_at = ?, paid_twd = ?, pay_method = ?, paid_at = ? WHERE id = ? AND ${guard}`)
        .bind(s.sub, now, paid, method, now, id),
      ctx.db
        .prepare("INSERT OR IGNORE INTO enrollments (member_sub, course_id, source_order_id) SELECT o.member_sub, i.course_id, o.id FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.id = ? AND o.status = 'opened'")
        .bind(id),
      notify(ctx.db, { sub: order.member_sub }, order.total_twd === 0 ? "報名審核通過，課程已開通" : action === "vip" ? "報名審核通過（VIP 免繳費），課程已開通" : "繳費確認完成，課程已開通", `審核人員：${by}${message ? `\n留言：${message}` : ""}`, `/orders/${id}`),
    );
  } else if (action === "reject" || action === "revoke") {
    statements.push(
      ctx.db
        .prepare(`UPDATE orders SET status = 'rejected', deferred = 0, reject_reason = ?, reviewed_by_sub = ?, reviewed_at = ?${action === "revoke" ? ", revoked_at = ?" : ""} WHERE id = ? AND ${guard}`)
        .bind(reasonText, s.sub, now, ...(action === "revoke" ? [now] : []), id),
      ...(action === "revoke" ? [ctx.db.prepare("DELETE FROM enrollments WHERE source_order_id = ?").bind(id)] : []),
      notify(ctx.db, { sub: order.member_sub }, action === "revoke" ? "課程開通已撤銷" : "報名已退回", `原因：${reasonText}\n審核人員：${by}`, `/orders/${id}`),
    );
  } else {
    statements.push(
      ctx.db.prepare(`UPDATE orders SET deferred = 1, reject_reason = ?, reviewed_by_sub = ?, reviewed_at = ? WHERE id = ? AND ${guard}`).bind(reasonText, s.sub, now, id),
      notify(ctx.db, { sub: order.member_sub }, "報名延後審核", `原因：${reasonText}\n審核人員：${by}`, `/orders/${id}`),
    );
  }
  statements.push(event(ctx.db, id, actor, action, { reason: code, message, note }), audit(ctx.db, s.sub, `order.${action}`, "order", id, code ?? ""));
  const [update] = await ctx.db.batch(statements);
  if (update.meta?.changes === 0) fail(409, "already_reviewed", "這筆報名已由其他人處理");
  return orderDetail(ctx, id);
}

/** 留言（雙方可見，通知對方）或私人備註（只有審核人員可見）。 */
export async function addOrderEvent(ctx: Ctx, id: string, body: Record<string, unknown>): Promise<Order> {
  const s = requireMember(ctx);
  const order = await ctx.db.prepare("SELECT member_sub FROM orders WHERE id = ?").bind(id).first<{ member_sub: string }>();
  const reviewer = !!order && order.member_sub !== s.sub && (await canReviewOrder(ctx, s, id));
  if (!order || (order.member_sub !== s.sub && !reviewer)) return fail(404, "not_found", "找不到這筆報名");
  const message = text(body.message, 500) ?? "";
  const note = reviewer ? (text(body.note, 500) ?? "") : "";
  if (!message && !note) fail(400, "empty", "請輸入內容");
  const actor = { sub: s.sub, name: s.name, title: reviewer ? titleOf(s, await dutyOf(ctx, s)) : "學員" };
  const statements = [event(ctx.db, id, actor, message ? "message" : "note", { message, note })];
  if (message && reviewer) statements.push(notify(ctx.db, { sub: order.member_sub }, "報名有新留言", `${actor.title} ${actor.name}：${message}`, `/orders/${id}`));
  if (message && !reviewer) {
    // 學員留言：通知處理過這筆報名的審核人員；還沒有人處理時，審核人員會在審核清單看到。
    const { results } = await ctx.db.prepare("SELECT DISTINCT actor_sub FROM order_events WHERE order_id = ? AND actor_sub <> ? AND action <> 'submit'").bind(id, s.sub).all<{ actor_sub: string }>();
    for (const r of results) statements.push(notify(ctx.db, { sub: r.actor_sub }, "學員在報名紀錄留言", `${s.name}：${message}`, `/admin/orders/${id}`));
  }
  await ctx.db.batch(statements);
  return orderDetail(ctx, id);
}

export async function reviewList(ctx: Ctx): Promise<{ rows: OrderRow[]; scope: ReviewScope }> {
  const s = requireMember(ctx);
  const scope = await reviewScope(ctx, s);
  if (!hasScope(scope)) fail(403, "forbidden", "需要審核權限");
  const w = scopeSql(scope);
  const q = ctx.url.searchParams;
  const conds = [w.sql, "(o.total_twd > 0 OR o.join_method <> '')"]; // 邀請制的申請與邀請碼加入（金額 0）也要看得到
  const args = [...w.args];
  const add = (cond: string, ...values: unknown[]) => {
    conds.push(cond);
    args.push(...values);
  };
  const status = q.get("status");
  if (status === "pending") add("o.status = 'pending' AND o.deferred = 0");
  else if (status === "deferred") add("o.status = 'pending' AND o.deferred = 1");
  else if (status === "opened" || status === "rejected") add("o.status = ?", status);
  if (q.get("courseId")) add("EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.course_id = ?)", q.get("courseId"));
  if (q.get("center")) add("o.center_key = ?", centerKey(q.get("center")!));
  if (q.get("hglobal") === "0") add("o.hglobal = 0");
  const term = (q.get("q") ?? "").trim().slice(0, 50);
  if (term) add("(o.member_name_snapshot LIKE ? OR o.id LIKE ? OR o.pay_ref LIKE ? OR o.member_sub = ?)", `%${term}%`, `%${term}%`, `%${term}%`, term);
  const { results } = await ctx.db.prepare(`${ORDER_SELECT} WHERE ${conds.join(" AND ")} ORDER BY o.created_at DESC LIMIT 2000`).bind(...args).all<OrderRow>();
  return { rows: results, scope };
}

export const csvCell = (v: unknown) => {
  let t = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; // 避免試算表把內容當成公式
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** 對帳報表（CSV，Excel 可直接開啟）：範圍與審核清單相同。 */
export async function reviewCsv(ctx: Ctx): Promise<Response> {
  const { rows } = await reviewList(ctx);
  const orders = await hydrateOrders(ctx.db, rows);
  const reviewers = new Map<string, string>();
  if (rows.length) {
    const { results } = await ctx.db
      .prepare("SELECT order_id, actor_title, actor_name FROM order_events WHERE action IN ('paid', 'vip', 'reject', 'defer', 'revoke') ORDER BY created_at")
      .all<{ order_id: string; actor_title: string; actor_name: string }>();
    for (const r of results) reviewers.set(r.order_id, `${r.actor_title} ${r.actor_name}`.trim());
  }
  const statusLabel = (o: Order) => (o.revoked ? "已撤銷" : o.status === "opened" ? "已開通" : o.status === "rejected" ? "已退回" : o.deferred ? "延後再審" : "待審核");
  const method: Record<string, string> = { cash: "現金", transfer: "轉帳", vip: "VIP 免繳費", online: "線上", free: "免費" };
  const lines = [
    ["報名編號", "付款代碼", "會員 ID", "報名時間", "課程", "姓名", "真實姓名（對帳）", "中心", "寰宇系統", "狀態", "應繳", "實收", "繳費方式", "審核人員", "審核時間", "原因"],
    ...orders.map((o) => [o.id, o.payRef ?? "", o.memberSub ?? "", o.createdAt, o.items.map((i) => i.title).join("、"), o.memberName, o.legalName ?? "", o.centerLabel, o.hglobal ? "是" : "否", statusLabel(o), o.totalTwd, o.paidTwd ?? "", o.payMethod ? method[o.payMethod] : "", reviewers.get(o.id) ?? "", o.reviewedAt ?? "", o.rejectReason ?? ""]),
  ];
  await audit(ctx.db, ctx.session!.sub, "order.export", "report", "csv", String(orders.length)).run();
  return new Response("﻿" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="registrations-${iso().slice(0, 10)}.csv"`, "cache-control": "no-store" },
  });
}

/**
 * 報名與營收報表（杜杜龍 2026-11-17）：指定期間（台灣日期，含頭尾）的報名，依中心／課程／月份加總；看得到的範圍與報名審核相同（總部全部、會長自己中心…）。
 * 免費報名也算在報名數裡；「繳費金額」＝已開通（未撤銷）的付費報名，有實收金額用實收，沒有用應繳。
 */
export async function registrationReport(ctx: Ctx): Promise<RegistrationReport> {
  const s = requireMember(ctx);
  const scope = await reviewScope(ctx, s);
  if (!hasScope(scope)) fail(403, "forbidden", "需要審核權限");
  const q = ctx.url.searchParams;
  const day = (v: string | null, d: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d);
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const from = day(q.get("from"), `${today.slice(0, 8)}01`);
  const to = day(q.get("to"), today);
  if (from > to) fail(400, "invalid_range", "開始日期不能晚於結束日期");
  const by: ReportBy = q.get("by") === "course" || q.get("by") === "month" ? (q.get("by") as ReportBy) : "center";
  // 台灣日期 → UTC 時間範圍
  const fromUtc = new Date(Date.parse(`${from}T00:00:00+08:00`)).toISOString();
  const toUtc = new Date(Date.parse(`${to}T00:00:00+08:00`) + 24 * 3600 * 1000).toISOString();
  const w = scopeSql(scope);
  const { results } = await ctx.db
    .prepare(`SELECT o.id, o.status, o.deferred, o.revoked_at, o.center_label, o.created_at, o.paid_twd, o.total_twd, i.course_id, i.title_snapshot, i.price_twd FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.created_at >= ? AND o.created_at < ? AND ${w.sql} ORDER BY o.created_at`)
    .bind(fromUtc, toUtc, ...w.args)
    .all<{ id: string; status: string; deferred: number; revoked_at: string | null; center_label: string; created_at: string; paid_twd: number | null; total_twd: number; course_id: string; title_snapshot: string; price_twd: number }>();
  const groups = new Map<string, ReportRow>();
  const total: ReportRow = { key: "total", label: "合計", registrations: 0, opened: 0, pending: 0, rejected: 0, free: 0, amountTwd: 0 };
  for (const r of results) {
    const twMonth = new Date(Date.parse(r.created_at) + 8 * 3600 * 1000).toISOString().slice(0, 7);
    const [key, label] = by === "course" ? [r.course_id, r.title_snapshot] : by === "month" ? [twMonth, `${twMonth.slice(0, 4)} 年 ${Number(twMonth.slice(5))} 月`] : [r.center_label || "", r.center_label || "（沒有中心）"];
    const g = groups.get(key) ?? { key, label, registrations: 0, opened: 0, pending: 0, rejected: 0, free: 0, amountTwd: 0 };
    const opened = r.status === "opened" && !r.revoked_at;
    // 一筆報名有多門課時，實收依各課定價比例分攤（目前一筆只有一門課，等於實收本身）。
    const share = r.total_twd > 0 ? r.price_twd / r.total_twd : 0;
    const amount = opened && r.price_twd > 0 ? Math.round((r.paid_twd ?? r.total_twd) * share) : 0;
    for (const x of [g, total]) {
      x.registrations++;
      if (opened) x.opened++;
      else if (r.status === "pending") x.pending++;
      else x.rejected++;
      if (r.price_twd === 0) x.free++;
      x.amountTwd += amount;
    }
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => (by === "month" ? a.key.localeCompare(b.key) : b.registrations - a.registrations || b.amountTwd - a.amountTwd || a.label.localeCompare(b.label)));
  return { from, to, by, rows, total };
}

export async function registrationReportCsv(ctx: Ctx): Promise<Response> {
  const r = await registrationReport(ctx);
  const head = r.by === "course" ? "課程" : r.by === "month" ? "月份" : "中心";
  const lines = [
    [`報名與營收報表（${r.from} ～ ${r.to}）`],
    [head, "報名數", "已開通", "待審核", "已退回／撤銷", "免費報名", "繳費金額（元）"],
    ...[...r.rows, r.total].map((x) => [x.label, x.registrations, x.opened, x.pending, x.rejected, x.free, x.amountTwd]),
  ];
  await audit(ctx.db, ctx.session!.sub, "report.export", "report", r.by, `${r.from}~${r.to}`).run();
  return new Response("\ufeff" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="report-${r.from}-${r.to}.csv"`, "cache-control": "no-store" },
  });
}

export type MediaType = "demo" | "youtube" | "mux" | "audio";

/** 接受 YouTube 網址（watch、youtu.be、shorts、embed）或 11 碼 ID。 */
export function youtubeId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^(www|m)\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1);
    else if (host === "youtube.com" || host === "youtube-nocookie.com")
      id = u.searchParams.get("v") ?? /^\/(?:shorts|embed|live)\/([^/?#]+)/.exec(u.pathname)?.[1] ?? null;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}


// ---------- 小編與中心 EDM 的共用檢查 ----------

/** 要管理哪個中心的小編：總部要指定中心（必須在會員中心的清單內）；會長、音控只能管自己中心。 */
export async function editorCenter(ctx: Ctx, rights: Rights, label: string | null | undefined): Promise<{ key: string; label: string }> {
  const want = (label ?? "").trim().slice(0, 100);
  if (rights.admin) {
    if (!want) {
      if (rights.center) return { key: centerKey(rights.center.label), label: rights.center.label };
      return fail(400, "center_required", "請先選擇中心");
    }
    await assertCentralCenters(ctx, [want]);
    return { key: centerKey(want), label: want };
  }
  if (!rights.staff || !rights.center) fail(403, "forbidden", "只有總部、各中心的會長與音控可以管理小編");
  if (want && centerKey(want) !== centerKey(rights.center!.label)) fail(403, "forbidden", "只能管理自己中心的小編");
  return { key: centerKey(rights.center!.label), label: rights.center!.label };
}

export function editorFlags(body: Record<string, unknown>, cur: EditorFlags): EditorFlags {
  const b = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return { create: b(body.canCreate, cur.create), editOthers: b(body.canEditOthers, cur.editOthers), deleteOthers: b(body.canDeleteOthers, cur.deleteOthers) };
}
export const editorFlagText = (f: EditorFlags) => [f.create && "新增課程", f.editOthers && "修改別人的課程", f.deleteOthers && "刪除別人的課程"].filter(Boolean).join("、") || "只能看";

export async function listEditors(ctx: Ctx, only?: { key: string; label: string }): Promise<CourseEditor[]> {
  const rights = await rightsOf(ctx);
  let center = only;
  if (!center) {
    const want = ctx.url.searchParams.get("center");
    // 總部沒指定中心：列出所有中心的小編。
    if (rights.admin && !want) center = undefined;
    else center = await editorCenter(ctx, rights, want);
  }
  if (!rights.admin && !rights.staff) fail(403, "forbidden", "只有總部、各中心的會長與音控可以管理小編");
  const { results } = await (center
    ? ctx.db.prepare("SELECT * FROM course_editors WHERE center_key = ? ORDER BY created_at").bind(center.key)
    : ctx.db.prepare("SELECT * FROM course_editors ORDER BY center_label, created_at")
  ).all<{ center_label: string; member_sub: string; member_name: string; can_create: number; can_edit_others: number; can_delete_others: number; created_at: string }>();
  return results.map((r) => ({ memberId: r.member_sub, name: r.member_name, center: r.center_label, canCreate: r.can_create === 1, canEditOthers: r.can_edit_others === 1, canDeleteOthers: r.can_delete_others === 1, createdAt: r.created_at }));
}

/** 中心 EDM：總部任何中心（名稱必須在會員中心清單內）；會長、音控、有「修改別人」權限的小編只能改自己中心。 */
// ---------- 封面輪播與相簿的共用函式 ----------
export type CoverRow = { owner_kind: string; center_key: string | null; owner_key: string; scope?: string; kind?: string; poster_key?: string | null };
export const coverKindOf = (v: string | null): CoverMediaKind => (v === "series" || v === "course" ? v : "center");
export const dim = (v: string | null) => Math.min(20000, Math.max(0, Math.round(Number(v) || 0)));
/** 相簿專區的資料夾彙整（杜杜龍 2026-11-25）：大類別順序＝設定的 albumOrder，資料夾一律按張數多到少；每個資料夾帶鎖定狀態與可否上傳。 */
export async function albumsIndex(ctx: Ctx): Promise<AlbumsResponse> {
  type G = { ok: string; scope: CoverScope; ck: string | null; k: string; n: number; thumbs: string | null };
  const [rows, arts, courses, blocks, cfg, treasure, perms] = await Promise.all([
    ctx.db
      .prepare("SELECT cm.owner_kind AS ok, cm.scope AS scope, cm.center_key AS ck, cm.owner_key AS k, COUNT(*) AS n, (SELECT GROUP_CONCAT(r2_key, '|') FROM (SELECT x.r2_key FROM cover_media x WHERE x.kind = 'image' AND x.owner_kind = cm.owner_kind AND x.scope = cm.scope AND COALESCE(x.center_key, '') = COALESCE(cm.center_key, '') AND x.owner_key = cm.owner_key ORDER BY x.position LIMIT 4)) AS thumbs FROM cover_media cm GROUP BY cm.owner_kind, cm.scope, cm.center_key, cm.owner_key")
      .all<G>(),
    ctx.db.prepare("SELECT center_key, center_label FROM center_art").all<{ center_key: string; center_label: string }>(),
    ctx.db.prepare("SELECT id, title FROM courses WHERE status = 'published'").all<{ id: string; title: string }>(),
    ctx.db.prepare("SELECT l.id, l.title, l.course_id, c.title AS course_title FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.kind = 'section' AND c.status = 'published'").all<{ id: string; title: string; course_id: string; course_title: string }>(),
    loadConfig(ctx.db),
    treasureCourseId(ctx.db).catch(() => null),
    albumPermMap(ctx.db),
  ]);
  const rights = ctx.session ? await rightsOf(ctx) : null;
  const label = new Map(arts.results.map((a) => [a.center_key, a.center_label]));
  const courseTitle = new Map(courses.results.map((c) => [c.id, c.title]));
  const block = new Map(blocks.results.map((b) => [b.id, b]));
  const locks = await lockStatesOf(ctx, [...new Set([...rows.results.filter((r) => r.ok === "course" && courseTitle.has(r.k)).map((r) => r.k), ...rows.results.filter((r) => r.ok === "course" && block.has(r.k)).map((r) => block.get(r.k)!.course_id)])]);
  const lockOf = (courseId: string) => {
    const l = locks.get(courseId);
    return l && l.locked ? { locked: true, lockReason: l.lines.join("、") || "沒有權限進入這個相簿" } : { locked: false };
  };
  const groups: Record<string, AlbumFolder[]> = { edm: [], cover: [], series: [], course: [], block: [], treasure: [], recipe: [] }; // recipe 永遠空（食譜不是照片資料夾，只佔順序）
  for (const r of rows.results) {
    const thumbs = r.thumbs ? r.thumbs.split("|").map((k) => pubUrl(k, 0)) : [];
    const base = { count: r.n, thumb: thumbs[0] ?? null, thumbs };
    if (r.ok === "center" && r.ck) {
      const title = label.get(r.ck) ?? r.ck;
      const scope: CoverScope = r.scope === "edm" ? "edm" : "cover";
      const canEdit = !!rights && (rights.admin || (!!rights.center && centerKey(rights.center.label) === r.ck && (rights.staff || !!rights.editor?.editOthers)));
      groups[scope]!.push({ id: `center:${r.ck}:${scope}`, kind: "center", key: title, scope, title, groupId: scope, ...base, locked: false, canEdit });
    } else if (r.ok === "series" && r.k) groups.series!.push({ id: `series:${r.k}`, kind: "series", key: r.k, title: r.k, groupId: "series", ...base, locked: false, canEdit: !!rights?.admin });
    else if (r.ok === "course") {
      const ct = courseTitle.get(r.k);
      const b = block.get(r.k);
      if (ct) groups.course!.push({ id: `course:${r.k}`, kind: "course", key: r.k, title: ct, groupId: "course", ...base, courseId: r.k, ...lockOf(r.k), canEdit: !!rights?.admin });
      else if (b) {
        // 成交百寶箱的區塊相簿單獨一個類別，不混在「課程區塊相簿」裡（杜杜龍 2026-11-25）。
        const gid = b.course_id === treasure ? "treasure" : "block";
        groups[gid]!.push({ id: `block:${r.k}`, kind: "block", key: r.k, title: b.title, subtitle: gid === "treasure" ? undefined : b.course_title, groupId: gid, ...base, courseId: b.course_id, ...lockOf(b.course_id), canEdit: !!rights?.admin });
      }
    }
  }
  // 獎銜達標的人可以上傳（相簿齒輪的「上傳權限」；資料夾自己的設定優先於類別）。
  if (ctx.session && perms.size) {
    const codes = [...new Set([...perms.values()].filter(Boolean))];
    const elig = await eligibilityFor(ctx.session, await ranks(ctx.db), codes);
    for (const list of Object.values(groups))
      for (const f of list) {
        const eff = perms.get(f.id) ?? perms.get(`group:${f.groupId}`);
        if (eff && elig.get(eff) === true && !f.locked) f.canEdit = true;
      }
  }
  const sort = (a: AlbumFolder, b: AlbumFolder) => b.count - a.count || a.title.localeCompare(b.title, "zh-Hant");
  const defs: [string, string][] = [["edm", "中心 EDM"], ["cover", "中心封面照片"], ["series", "系列封面照片"], ["course", "課程封面照片"], ["block", "課程區塊相簿"], ["treasure", "成交百寶箱"], ["recipe", "食譜"]];
  const order = cfg.albumOrder ?? [];
  const pos = (id: string) => (order.includes(id) ? order.indexOf(id) : 100 + defs.findIndex((d) => d[0] === id));
  const out = defs
    .map(([id, l]) => ({ id, label: l, folders: groups[id]!.sort(sort) }))
    .filter((g) => g.folders.length)
    .sort((a, b) => pos(a.id) - pos(b.id));
  const orderAll = [...out.map((g) => g.id), "recipe"].sort((a, b) => pos(a) - pos(b)); // 食譜專區不是照片資料夾，但和其他類別一起排順序
  return { total: out.reduce((n, g) => n + g.folders.reduce((m, f) => m + f.count, 0), 0), groups: out, order: orderAll };
}
/** 全站 AI 辨識（文字 OCR、場景）還沒處理的張數與預估完成時間（圖片資訊「藍字」區給所有人看；杜杜龍 2026-11-26）。速度取最近 3 小時實際完成的張數。 */
export async function aiQueueInfo(db: D1Database, edm: boolean): Promise<{ pending: number; perHour: number; etaMin: number | null; quotaOut: boolean; sceneOn: boolean; ocrOn: boolean }> {
  // 只算「這張圖所屬那一類」的待辨識張數：中心 EDM 只有文字辨識；相簿（區塊）照片有文字＋場景（杜杜龍 2026-11-26）。
  const since = new Date(Date.now() - 3 * 3600_000).toISOString();
  const [q, st, used, ss] = await Promise.all([
    db
      .prepare(
        `SELECT
          SUM(CASE WHEN kind = 'image' AND ocr_status = '' AND ((owner_kind = 'center' AND scope = 'edm') OR owner_kind = 'course') THEN 1 ELSE 0 END) AS po,
          SUM(CASE WHEN kind = 'image' AND owner_kind = 'course' AND scene_status = '' THEN 1 ELSE 0 END) AS ps,
          SUM(CASE WHEN kind = 'image' AND owner_kind = 'center' AND scope = 'edm' AND ocr_status = '' THEN 1 ELSE 0 END) AS pe,
          SUM(CASE WHEN ocr_status = 'done' AND ocr_at >= ?1 THEN 1 ELSE 0 END) AS dof,
          SUM(CASE WHEN scene_status = 'done' AND scene_at >= ?1 THEN 1 ELSE 0 END) AS dsc
        FROM cover_media`,
      )
      .bind(since)
      .first<{ po: number | null; ps: number | null; pe: number | null; dof: number | null; dsc: number | null }>(),
    loadAiSettings(db),
    aiTodayUsed(db),
    (await import("./search-settings.ts")).loadSearchSettings(db),
  ]);
  const sceneOn = ss.aiOnScene !== false;
  const ocrOn = edm ? ss.aiOnEdm !== false : ss.photoOcrEnabled !== false;
  const pending = edm ? (q?.pe ?? 0) : (q?.po ?? 0) - (q?.pe ?? 0) + (sceneOn ? (q?.ps ?? 0) : 0);
  const perHour = Math.round((((q?.dof ?? 0) + (edm ? 0 : sceneOn ? (q?.dsc ?? 0) : 0)) / 3) * 10) / 10;
  return { pending, perHour, etaMin: pending && perHour > 0 ? Math.ceil((pending / perHour) * 60) : null, quotaOut: !!st.capEnabled && used >= st.dailyCap, sceneOn, ocrOn };
}

export function coverItem(r: { id: string; scope: CoverScope; folder_id?: string | null; created_at?: string | null; uploader_name?: string | null; uploader_avatar?: string | null; scene_text?: string | null; ocr_text?: string | null; event_date?: string | null; course_id?: string | null; course_title?: string | null; kind: "image" | "video"; r2_key: string; poster_key: string | null; width: number; height: number; duration_sec: number }): CoverMediaItem {
  return {
    id: r.id,
    scope: r.scope === "edm" ? "edm" : "cover",
    ...(r.course_id ? { courseId: r.course_id, courseTitle: r.course_title ?? "" } : {}),
    kind: r.kind,
    url: r.kind === "video" ? `/api/v2/media/album?k=${encodeURIComponent(r.r2_key)}` : pubUrl(r.r2_key, 0),
    posterUrl: r.poster_key ? pubUrl(r.poster_key, 0) : null,
    width: r.width,
    height: r.height,
    durationSec: r.duration_sec,
    ...(r.scope === "edm" ? { eventDate: r.event_date ?? null, text: r.ocr_text ?? "" } : r.ocr_text ? { text: r.ocr_text } : {}),
    ...(r.scene_text ? { scene: r.scene_text } : {}),
    ...(r.created_at ? { createdAt: r.created_at } : {}),
    ...(r.folder_id ? { folderId: r.folder_id } : {}),
    ...(r.uploader_name ? { uploader: r.uploader_name, ...(r.uploader_avatar ? { uploaderAvatar: r.uploader_avatar } : {}) } : {}),
  };
}
/** 儲存區（杜杜龍 2026-11-23）：只有中心有「EDM」分頁；系列、課程一律只有 cover。沒帶或不認得時，中心當 edm（舊版 App 的相簿上傳）。 */
export const coverScopeOf = (kind: CoverMediaKind, v: unknown): CoverScope => (kind !== "center" ? "cover" : v === "cover" ? "cover" : "edm");
/** lookup：center＝中心鑰匙（centerKey）；series＝系列名稱；course＝課程編號。scope 有給就只取那一區，沒給＝兩區都取（公開讀取用）。 */
export async function coverItems(db: D1Database, kind: CoverMediaKind, lookup: string, scope?: CoverScope): Promise<CoverMediaItem[]> {
  const where = (kind === "center" ? "cm.owner_kind = 'center' AND cm.center_key = ?" : "cm.owner_kind = ? AND cm.owner_key = ?") + (scope ? " AND cm.scope = ?" : "");
  // 課程 EDM（綁定課程的照片）不受 100 張上限限制，所以讀取上限放寬。
  const st = db.prepare(`SELECT cm.id, cm.scope, cm.kind, cm.r2_key, cm.poster_key, cm.width, cm.height, cm.duration_sec, cm.course_id, cm.ocr_text, cm.event_date, cm.created_at, cm.folder_id, COALESCE(NULLIF(mp.name, ''), cm.uploader_name) AS uploader_name, COALESCE(NULLIF(mp.avatar, ''), cm.uploader_avatar) AS uploader_avatar, c.title AS course_title FROM cover_media cm LEFT JOIN courses c ON c.id = cm.course_id LEFT JOIN member_profiles mp ON mp.sub = cm.created_by WHERE ${where} ORDER BY cm.scope, cm.position, CASE WHEN cm.scope = 'edm' THEN cm.event_date IS NULL ELSE 0 END, CASE WHEN cm.scope = 'edm' THEN cm.event_date END DESC, cm.created_at, cm.rowid LIMIT 2000`);
  const args = [...(kind === "center" ? [lookup] : [kind, lookup]), ...(scope ? [scope] : [])];
  const { results } = await st.bind(...args).all<{ id: string; scope: CoverScope; folder_id: string | null; created_at: string | null; uploader_name: string | null; uploader_avatar: string | null; ocr_text: string | null; event_date: string | null; course_id: string | null; course_title: string | null; kind: "image" | "video"; r2_key: string; poster_key: string | null; width: number; height: number; duration_sec: number }>();
  return results.map(coverItem);
}
/**
 * 課程 EDM 併入中心 EDM 空間（杜杜龍 2026-11-23）：中心主辦、已發佈、有 EDM 的課程，其 EDM 圖自動成為該中心 EDM 空間（scope = edm）的一張，用 course_id 綁定；
 * 課程換圖、改主辦中心、下架、刪除，這裡跟著同步。每次讀中心先用一個便宜的查詢檢查，有差異才寫入（所以已上傳和未來上傳的都會自動併入）。
 */
export async function reconcileCenterEdm(db: D1Database, key: string): Promise<void> {
  const ok = "c.host_center_key = ?1 AND c.status = 'published' AND c.edm_key IS NOT NULL";
  const need = await db
    .prepare(
      `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM courses c WHERE ${ok} AND NOT EXISTS (SELECT 1 FROM cover_media m WHERE m.course_id = c.id AND m.center_key = ?1 AND m.r2_key = c.edm_key))
       OR EXISTS (SELECT 1 FROM cover_media m WHERE m.owner_kind = 'center' AND m.center_key = ?1 AND m.course_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM courses c WHERE c.id = m.course_id AND ${ok} AND c.edm_key = m.r2_key))`,
    )
    .bind(key)
    .first();
  if (!need) return;
  const base = "(SELECT COALESCE(MAX(position), -1) FROM cover_media WHERE owner_kind = 'center' AND center_key = ?1 AND scope = 'edm')";
  await db.batch([
    // 課程改主辦到這個中心：把原本在別的中心的綁定照片搬過來
    db.prepare(`UPDATE cover_media SET center_key = ?1, scope = 'edm', position = ${base} + 1 WHERE owner_kind = 'center' AND course_id IN (SELECT c.id FROM courses c WHERE ${ok}) AND center_key <> ?1`).bind(key),
    // 課程不在這裡了（改中心、下架、刪除、移除 EDM）：只拿掉綁定的照片紀錄，檔案歸課程管，不刪檔
    db.prepare(`DELETE FROM cover_media WHERE owner_kind = 'center' AND center_key = ?1 AND course_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM courses c WHERE c.id = cover_media.course_id AND ${ok})`).bind(key),
    // 課程換了 EDM：同步新的檔案（寬高重新量）
    db.prepare(`UPDATE cover_media SET r2_key = (SELECT c.edm_key FROM courses c WHERE c.id = cover_media.course_id), width = 0, height = 0, ocr_status = '', ocr_text = '', event_date = NULL WHERE owner_kind = 'center' AND center_key = ?1 AND course_id IS NOT NULL AND r2_key <> (SELECT c.edm_key FROM courses c WHERE c.id = cover_media.course_id)`).bind(key),
    // 還沒綁定的課程 EDM：新增（接在最後面，依課程建立時間）
    db.prepare(
      `INSERT INTO cover_media (id, owner_kind, center_key, owner_key, kind, r2_key, width, height, position, created_by, scope, course_id)
       SELECT lower(hex(randomblob(8))), 'center', ?1, '', 'image', c.edm_key, 0, 0, ${base} + ROW_NUMBER() OVER (ORDER BY c.created_at, c.id), 'course-edm', 'edm', c.id
       FROM courses c WHERE ${ok} AND NOT EXISTS (SELECT 1 FROM cover_media m WHERE m.course_id = c.id)`,
    ).bind(key),
  ]);
}
/** 舊照片沒有記寬高（0）時，從檔頭量出來存回去（一次最多 6 張）；封面輪播要靠它判斷橫式或直式。 */
export async function fillImageDims(env: Env, db: D1Database, kind: CoverMediaKind, lookup: string): Promise<void> {
  const bucket = env.MEDIA;
  if (!bucket) return;
  const where = kind === "center" ? "owner_kind = 'center' AND center_key = ?" : "owner_kind = ? AND owner_key = ?";
  const st = db.prepare(`SELECT id, r2_key FROM cover_media WHERE ${where} AND kind = 'image' AND (width <= 0 OR height <= 0) LIMIT 6`);
  const { results } = await (kind === "center" ? st.bind(lookup) : st.bind(kind, lookup)).all<{ id: string; r2_key: string }>();
  for (const r of results) {
    try {
      const o = await bucket.get(r.r2_key, { range: { offset: 0, length: 131072 } });
      if (!o) continue;
      const size = imageSize(new Uint8Array(await new Response((o as unknown as { body: ReadableStream }).body).arrayBuffer()));
      if (size) await db.prepare("UPDATE cover_media SET width = ?, height = ? WHERE id = ?").bind(Math.min(20000, size.width), Math.min(20000, size.height), r.id).run();
    } catch {
      /* 量不出來就維持原狀，下次再試 */
    }
  }
}
/**
 * 相簿「誰可以上傳」的獎銜設定（杜杜龍 2026-11-25，超級管理員在相簿齒輪設定；成交百寶箱預設白金以上）：
 * 資料夾自己的設定優先於類別；有設定而且會員獎銜達標，就算有上傳權（只限上傳與補預覽圖、資訊，不能刪除、排序別人的照片）。
 */
export async function albumPermMap(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db.prepare("SELECT key, upload_min_rank FROM album_permissions").all<{ key: string; upload_min_rank: string }>();
  return new Map(results.map((r) => [r.key, r.upload_min_rank]));
}
/** 一個封面位置（kind＋key＋scope）對應的相簿資料夾編號與大類別。 */
export async function albumRefOf(db: D1Database, kind: CoverMediaKind, key: string, scope: CoverScope | string | undefined): Promise<{ folderId: string; groupId: string; blockOff?: boolean }> {
  if (kind === "center") {
    const sc = scope === "edm" ? "edm" : "cover";
    return { folderId: `center:${centerKey(key)}:${sc}`, groupId: sc };
  }
  if (kind === "series") return { folderId: `series:${key}`, groupId: "series" };
  const blk = await db.prepare("SELECT l.course_id, c.block_photos FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ? AND l.kind = 'section'").bind(key).first<{ course_id: string; block_photos: number }>();
  if (blk) return { folderId: `block:${key}`, groupId: blk.course_id === (await treasureCourseId(db).catch(() => null)) ? "treasure" : "block", blockOff: blk.block_photos !== 1 };
  return { folderId: `course:${key}`, groupId: "course" };
}
export async function albumRankAllows(ctx: Ctx, ref: { folderId: string; groupId: string; blockOff?: boolean }): Promise<boolean> {
  if (!ctx.session || ref.blockOff) return false;
  const perms = await albumPermMap(ctx.db);
  const eff = perms.get(ref.folderId) ?? perms.get(`group:${ref.groupId}`);
  if (!eff) return false;
  const elig = await eligibilityFor(ctx.session, await ranks(ctx.db), [eff]);
  return elig.get(eff) === true;
}
/** 教材圖片（上傳檔案當教材、雲端硬碟匯入）的壓縮：格式與畫質直接套用「相簿存檔格式」（杜杜龍 2026-11-25）；套用範圍跟著相簿的範圍設定（試行期只有成交百寶箱的課程）。 */
export async function materialImageOverride(ctx: Ctx, courseId: string | null | undefined): Promise<{ format: "jpeg" | "webp" | "avif"; quality: number } | undefined> {
  const app = (await loadConfig(ctx.db)).app;
  if (app.albumScope === "off") return undefined;
  if (app.albumScope === "treasure" && courseId !== (await treasureCourseId(ctx.db).catch(() => null))) return undefined;
  return { format: app.albumFormat, quality: app.albumQuality };
}
/** 區塊相簿子資料夾（杜杜龍 2026-11-26）：只有區塊相簿（cover_media 的 course 類、owner_key 是區塊編號）有；最多一層；名稱最多 20 字、同一區塊不可重複。 */
export const FOLDER_NAME_MAX = 20;
export async function requireFolderManage(ctx: Ctx, key: string): Promise<Session> {
  const s = requireMember(ctx);
  try {
    await requireCourseArt(ctx, s, await courseOfCoverKey(ctx.db, key));
    return s;
  } catch (e) {
    if (await albumRankAllows(ctx, await albumRefOf(ctx.db, "course", key, "cover"))) return s; // 白金以上等「上傳權限」達標的人也能管理資料夾、移動照片
    throw e;
  }
}
export async function isBlockKey(db: D1Database, key: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS ok FROM lessons WHERE id = ? AND kind = 'section'").bind(key).first());
}
export async function putInFolder(ctx: Ctx, o: { kind: CoverMediaKind; ownerKey: string }, photoId: string): Promise<void> {
  const fid = (ctx.url.searchParams.get("folder") ?? "").slice(0, 40);
  if (!fid || o.kind !== "course") return;
  const ok = await ctx.db.prepare("SELECT 1 AS ok FROM album_folders WHERE id = ? AND owner_key = ?").bind(fid, o.ownerKey).first();
  if (ok) await ctx.db.prepare("UPDATE cover_media SET folder_id = ? WHERE id = ?").bind(fid, photoId).run();
}
export async function subfoldersOf(ctx: Ctx, key: string): Promise<AlbumSubfolders> {
  const [fs, counts, thumbs] = await Promise.all([
    ctx.db.prepare("SELECT id, name FROM album_folders WHERE owner_key = ?").bind(key).all<{ id: string; name: string }>(),
    ctx.db.prepare("SELECT folder_id AS f, COUNT(*) AS n FROM cover_media WHERE owner_kind = 'course' AND owner_key = ? AND scope = 'cover' AND kind = 'image' GROUP BY folder_id").bind(key).all<{ f: string; n: number }>(),
    ctx.db.prepare("SELECT folder_id AS f, r2_key FROM cover_media WHERE owner_kind = 'course' AND owner_key = ? AND scope = 'cover' AND kind = 'image' ORDER BY position").bind(key).all<{ f: string; r2_key: string }>(),
  ]);
  const n = new Map(counts.results.map((r) => [r.f, r.n]));
  const t = new Map<string, string[]>();
  for (const r of thumbs.results) {
    const l = t.get(r.f) ?? [];
    if (l.length < 4) l.push(pubUrl(r.r2_key, 0));
    t.set(r.f, l);
  }
  let canManage = false;
  try {
    if (ctx.session) {
      await requireFolderManage(ctx, key);
      canManage = true;
    }
  } catch {
    canManage = false;
  }
  return {
    folders: fs.results.map((f) => ({ id: f.id, name: f.name, count: n.get(f.id) ?? 0, thumbs: t.get(f.id) ?? [] })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hant")),
    uncat: { count: n.get("") ?? 0, thumbs: t.get("") ?? [] },
    canManage,
  };
}
/**
 * 食譜專區的權限（杜杜龍 2026-11-26）：管理者＝超級管理員、總部管理員，或「食譜」上傳獎銜（相簿齒輪 group:recipe）達標的會員——可直接發佈、審核投稿、新增與改名分類、修改任何食譜。
 * 一般會員可以投稿（進「待審核」），投稿者自己在草稿與待審核時可修改、刪除；核准後只有管理者能改。
 */
export async function recipeManager(ctx: Ctx): Promise<boolean> {
  if (!ctx.session) return false;
  if (ctx.session.roles.includes("super_admin") || (await rightsOf(ctx)).admin) return true;
  return albumRankAllows(ctx, { folderId: "recipe", groupId: "recipe" });
}
export type RecipeRow = { author_center_label: string; number: number | null; id: string; title: string; category_id: string; body: string; status: "draft" | "pending" | "published"; author_sub: string; author_name: string; updated_at: string };
export async function recipeRow(ctx: Ctx, id: string): Promise<RecipeRow> {
  return (await ctx.db.prepare("SELECT number, id, title, category_id, body, status, author_sub, author_name, author_center_label, updated_at FROM recipes WHERE id = ?").bind(id).first<RecipeRow>()) ?? fail(404, "not_found", "找不到這道食譜");
}
export async function requireRecipeEdit(ctx: Ctx, id: string): Promise<{ s: Session; row: RecipeRow; manager: boolean }> {
  const s = requireMember(ctx);
  const row = await recipeRow(ctx, id);
  const manager = await recipeManager(ctx);
  if (!manager && !(row.author_sub === s.sub && row.status !== "published")) fail(403, "forbidden", "這道食譜已經發佈，只有管理者能修改");
  return { s, row, manager };
}
export async function recipeDetail(ctx: Ctx, row: RecipeRow): Promise<RecipeDetail> {
  const manager = await recipeManager(ctx);
  const mine = !!ctx.session && row.author_sub === ctx.session.sub;
  if (row.status !== "published" && !manager && !mine) fail(404, "not_found", "找不到這道食譜");
  const cat = row.category_id ? await ctx.db.prepare("SELECT name FROM recipe_categories WHERE id = ?").bind(row.category_id).first<{ name: string }>() : null;
  const shortPath = row.number && row.status === "published" ? recipeShortPath((await recipePrefixes(ctx.db)).cur, row.number) : null;
  return { authorCenter: row.author_center_label, admin: !!ctx.session?.roles.includes("super_admin"), id: row.id, number: row.number, shortPath, title: row.title, categoryId: row.category_id, categoryName: cat?.name ?? "", body: row.body, status: row.status, authorName: row.author_name, updatedAt: row.updated_at, canEdit: manager || (mine && row.status !== "published"), manager };
}
/** 這次請求要管理的封面（含權限檢查）：中心＝能編輯該中心封面的人；系列＝超級管理員；課程＝有該課程修改權的人。 */
export async function requireCoverOwner(ctx: Ctx, fromBody = false) {
  const base = ctx;
  try {
    return await requireCoverOwnerBase(base, fromBody);
  } catch (e) {
    // 上傳（不是排序、刪除）：原本沒權限，但相簿「上傳權限」設定的獎銜達標也可以。
    if (!fromBody && ctx.session) {
      const kind = coverKindOf(ctx.url.searchParams.get("kind"));
      const key = (ctx.url.searchParams.get("key") ?? "").trim().slice(0, 100);
      const scope = coverScopeOf(kind, ctx.url.searchParams.get("scope"));
      if (key && (await albumRankAllows(ctx, await albumRefOf(ctx.db, kind, key, scope)))) {
        const ck = kind === "center" ? centerKey(key) : null;
        return { s: ctx.session, kind, lookup: ck ?? key, centerKey: ck, ownerKey: kind === "center" ? "" : key, scope };
      }
    }
    throw e;
  }
}
export async function requireCoverOwnerBase(ctx: Ctx, fromBody = false): Promise<{ s: Session; kind: CoverMediaKind; lookup: string; centerKey: string | null; ownerKey: string; scope: CoverScope }> {
  let kind: CoverMediaKind;
  let key: string;
  let scopeRaw: unknown;
  if (fromBody) {
    const c = ctx.req.clone();
    const b = (await c.json().catch(() => ({}))) as { kind?: unknown; key?: unknown; scope?: unknown };
    kind = coverKindOf(typeof b.kind === "string" ? b.kind : null);
    key = typeof b.key === "string" ? b.key.trim().slice(0, 100) : "";
    scopeRaw = b.scope;
  } else {
    kind = coverKindOf(ctx.url.searchParams.get("kind"));
    key = (ctx.url.searchParams.get("key") ?? "").trim().slice(0, 100);
    scopeRaw = ctx.url.searchParams.get("scope");
  }
  const scope = coverScopeOf(kind, scopeRaw);
  if (!key) fail(400, "invalid_key", "請指定要放封面的位置");
  if (kind === "center") {
    const { s, center } = await requireCenterArt(ctx, key);
    return { s, kind, lookup: center.key, centerKey: center.key, ownerKey: "", scope };
  }
  if (kind === "series") {
    const s = requireSuperAdmin(ctx);
    return { s, kind, lookup: key, centerKey: null, ownerKey: key, scope };
  }
  const s = requireMember(ctx);
  const rid = recipeIdOfKey(key);
  if (rid) await requireRecipeEdit(ctx, rid); // 食譜照片（杜杜龍 2026-11-26）：管理者，或投稿者自己在草稿／待審核時
  else await requireCourseArt(ctx, s, await courseOfCoverKey(ctx.db, key));
  return { s, kind, lookup: key, centerKey: null, ownerKey: key, scope };
}
/** 刪除、換預覽圖時：依資料列所屬的封面檢查權限。 */
export async function requireCoverRowOwner(ctx: Ctx, row: CoverRow): Promise<Session> {
  try {
    return await requireCoverRowOwnerBase(ctx, row);
  } catch (e) {
    // 補預覽圖、資訊（PUT）：上傳權限設定達標的人也可以（刪除不行）。
    if (ctx.req.method === "PUT" && ctx.session) {
      const kind: CoverMediaKind = row.owner_kind === "center" ? "center" : row.owner_kind === "series" ? "series" : "course";
      const key = kind === "center" ? (row.center_key ?? "") : row.owner_key;
      if (key && (await albumRankAllows(ctx, kind === "center" ? { folderId: `center:${row.center_key}:${row.scope === "edm" ? "edm" : "cover"}`, groupId: row.scope === "edm" ? "edm" : "cover" } : await albumRefOf(ctx.db, kind, key, row.scope)))) return ctx.session;
    }
    throw e;
  }
}
export async function requireCoverRowOwnerBase(ctx: Ctx, row: CoverRow): Promise<Session> {
  const s = requireMember(ctx);
  if (row.owner_kind === "center") {
    const rights = await rightsOf(ctx);
    const mine = rights.center && row.center_key === centerKey(rights.center.label);
    if (!rights.admin && !(mine && (rights.staff || rights.editor?.editOthers))) fail(403, "forbidden", "只能修改自己中心的封面");
  } else if (row.owner_kind === "series") requireSuperAdmin(ctx);
  else if (recipeIdOfKey(row.owner_key)) await requireRecipeEdit(ctx, recipeIdOfKey(row.owner_key)!);
  else await requireCourseArt(ctx, s, await courseOfCoverKey(ctx.db, row.owner_key));
  return s;
}
/** 圖片資訊（相簿照片）：管理者看完整內容；其他人拿掉 GPS 與帳號編號，鎖住課程的照片不給。 */
/** R2 裡這個檔案目前的格式：type＝R2 記錄的 Content-Type，ext＝檔名副檔名（type 查不到時的備援），bytes＝實際大小。 */
export async function storedInfo(env: Env, key: string, fallbackBytes: number): Promise<{ type: string; ext: string; bytes: number }> {
  const head = key && env.MEDIA ? await env.MEDIA.head(key).catch(() => null) : null;
  return { type: head?.httpMetadata?.contentType ?? "", ext: (/\.([A-Za-z0-9]{2,5})$/.exec(key)?.[1] ?? "").toLowerCase(), bytes: head?.size ?? fallbackBytes };
}
export async function coverMediaInfo(ctx: Ctx, id: string) {
  // 圖片資訊面板（杜杜龍 2026-11-24；2026-11-25 開放給所有人含訪客）：管理這個相簿的人看完整內容；
  // 其他人看到同樣的面板，但 EXIF 的 GPS 位置（緯度、經度、海拔）與上傳者帳號編號會拿掉，沒權限看的課程照片也不給。
  const r = await ctx.db
    .prepare("SELECT cm.id, cm.owner_kind, cm.center_key, cm.owner_key, cm.scope, cm.kind, cm.width, cm.height, cm.duration_sec, cm.bytes, cm.position, cm.created_by, cm.created_at, cm.uploader_name, cm.meta, cm.r2_key, cm.course_id, cm.ocr_text, cm.ocr_fields, cm.ocr_fmt, cm.ocr_status, cm.ocr_model, cm.ocr_at, cm.scene_status, cm.scene_text, cm.event_date, c.title AS course_title, (SELECT display_name FROM sessions WHERE member_sub = cm.created_by ORDER BY expires_at DESC LIMIT 1) AS session_name, (SELECT name FROM member_profiles WHERE sub = cm.created_by) AS profile_name FROM cover_media cm LEFT JOIN courses c ON c.id = cm.course_id WHERE cm.id = ?")
    .bind(id)
    .first<Record<string, string | number | null>>();
  if (!r) return fail(404, "not_found", "找不到這張照片");
  let manager = true;
  try {
    await requireCoverRowOwner(ctx, r as unknown as CoverRow);
  } catch {
    manager = false;
    if (r.owner_kind === "course") {
      const blk = await ctx.db.prepare("SELECT course_id FROM lessons WHERE id = ? AND kind = 'section'").bind(String(r.owner_key)).first<{ course_id: string }>();
      const lk = await lockStateOfKey(ctx, blk?.course_id ?? String(r.owner_key));
      if (lk.locked && !lk.manages) return fail(403, "locked", lk.lines[0] ?? "沒有權限");
    }
  }
  const fieldsNow = await loadFields(ctx.db);
  let meta: { exif?: Record<string, unknown>; file?: Record<string, unknown> } = {};
  try {
    meta = r.meta ? (JSON.parse(String(r.meta)) as typeof meta) : {};
  } catch {
    meta = {};
  }
  // 還沒用目前格式整理過：背景補整理（額度用完或沒綁定 AI 就略過）
  if (r.kind === "image" && r.ocr_text && r.ocr_fmt !== fmtOf(fieldsNow) && ctx.defer) ctx.defer(structureEdm(ctx.env, ctx.db, String(r.id)).catch(() => undefined));
  const byRaw = String(r.created_by ?? "");
  const system = byRaw === "migration" || byRaw === "course-edm";
  return {
    id: r.id,
    kind: r.kind,
    scope: r.scope,
    width: r.width,
    height: r.height,
    durationSec: r.duration_sec,
    bytes: r.bytes,
    position: r.position,
    ownerKind: r.owner_kind,
    ownerKey: r.owner_kind === "center" ? r.center_key : r.owner_key,
    uploader: system ? (byRaw === "course-edm" ? "系統（由課程 EDM 自動併入）" : "系統（舊資料搬移）") : String(r.profile_name || r.uploader_name || r.session_name || ""),
    uploaderSub: system || !manager ? "" : byRaw,
    uploadedAt: r.created_at,
    courseId: r.course_id,
    courseTitle: r.course_title,
    ocrStatus: r.ocr_status,
    sceneStatus: String(r.scene_status ?? ""),
    sceneText: String(r.scene_text ?? ""),
    queue: await aiQueueInfo(ctx.db, r.owner_kind === "center" && r.scope === "edm"),
    ocrModel: r.ocr_model,
    ocrAt: r.ocr_at,
    eventDate: r.event_date,
    ocrText: cleanOcrText(String(r.ocr_text ?? "")),
    structured: (() => {
      // 套入「AI 文字辨識」欄位格式後的內容（杜杜龍 2026-11-24）：沒整理好時 fields 是 null，畫面改顯示清理過的原文。
      try {
        const st = r.ocr_fields ? (JSON.parse(String(r.ocr_fields)) as Structured) : null;
        return { fields: st?.f ?? null, other: st?.o ?? "", stale: r.ocr_fmt !== fmtOf(fieldsNow) };
      } catch {
        return { fields: null, other: "", stale: true };
      }
    })(),
    // 目前存在 R2 的檔案格式（杜杜龍 2026-11-25，所有人都看得到）：以 R2 實際的檔案類型為準，查不到就看檔名副檔名。
    stored: await storedInfo(ctx.env, String(r.r2_key ?? ""), Number(r.bytes) || 0),
    file: meta.file ?? {},
    exif: manager ? meta.exif ?? {} : Object.fromEntries(Object.entries(meta.exif ?? {}).filter(([k]) => !/^(latitude|longitude|GPS)/i.test(k))),
  };
}

/**
 * 任何圖片都有「圖片資訊」（杜杜龍 2026-11-25：所有的照片都要有驚嘆號）：用儲存檔名（網址的 k）查。
 * 是相簿照片 → 走 coverMediaInfo；否則（課程封面、EDM、系列／中心封面、品牌 logo、課表…）回基本資訊：儲存空間裡的檔案大小、類型、上傳時間與所屬項目。
 */
export async function imageInfoByKey(ctx: Ctx) {
  const k = (ctx.url.searchParams.get("k") ?? "").slice(0, 300);
  if (!k) return fail(400, "invalid_key", "缺少圖片");
  const cm = await ctx.db.prepare("SELECT id FROM cover_media WHERE r2_key = ? OR poster_key = ? LIMIT 1").bind(k, k).first<{ id: string }>();
  if (cm) return coverMediaInfo(ctx, cm.id);
  const one = async (sql: string) => (await ctx.db.prepare(sql).bind(k).first<{ a: string | null; b: string | null }>()) ?? null;
  let owner: { kind: "center" | "series" | "course"; key: string; label: string; courseId?: string } | null = null;
  const c = await one("SELECT id AS a, title AS b FROM courses WHERE (cover_key = ?1 OR edm_key = ?1) AND status = 'published' LIMIT 1");
  const ln = !c ? await one("SELECT c.id AS a, c.title || ' › ' || l.title AS b FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.cover_key = ?1 AND c.status = 'published' LIMIT 1") : null;
  const sr = !c && !ln ? await one("SELECT series AS a, series AS b FROM series_art WHERE cover_key = ?1 OR edm_key = ?1 LIMIT 1") : null;
  const ct = !c && !ln && !sr ? await one("SELECT center_key AS a, center_key AS b FROM center_art WHERE cover_key = ?1 OR edm_key = ?1 LIMIT 1") : null;
  const br = !c && !ln && !sr && !ct ? await one("SELECT id AS a, name AS b FROM brand_logos WHERE logo_key = ?1 OR bg_key = ?1 LIMIT 1") : null;
  const sc = !c && !ln && !sr && !ct && !br ? await one("SELECT center_key AS a, ym AS b FROM center_schedules WHERE image_key = ?1 LIMIT 1") : null;
  if (c) owner = { kind: "course", key: c.b ?? "", label: c.b ?? "", courseId: c.a ?? undefined };
  else if (ln) owner = { kind: "course", key: ln.b ?? "", label: ln.b ?? "", courseId: ln.a ?? undefined };
  else if (sr) owner = { kind: "series", key: sr.a ?? "", label: sr.a ?? "" };
  else if (ct) owner = { kind: "center", key: ct.a ?? "", label: ct.a ?? "" };
  else if (br) owner = { kind: "course", key: `品牌：${br.b ?? ""}`, label: br.b ?? "" };
  else if (sc) owner = { kind: "center", key: `${sc.a ?? ""} ${sc.b ?? ""} 課表`, label: sc.a ?? "" };
  const head = await ctx.env.MEDIA?.head(k).catch(() => null);
  if (!head && !owner) return fail(404, "not_found", "找不到這張圖片的資料");
  return {
    id: k,
    kind: "image",
    scope: "cover",
    width: 0,
    height: 0,
    durationSec: 0,
    bytes: head?.size ?? 0,
    position: 0,
    ownerKind: owner?.kind ?? "course",
    ownerKey: owner?.key ?? "",
    uploader: "",
    uploaderSub: "",
    uploadedAt: (head as { uploaded?: Date } | null | undefined)?.uploaded?.toISOString() ?? "",
    courseId: owner?.courseId ?? null,
    courseTitle: owner?.kind === "course" ? owner.label : null,
    ocrStatus: "none",
    ocrModel: "",
    ocrAt: null,
    eventDate: null,
    ocrText: "",
    structured: { fields: null, other: "", stale: false },
    stored: await storedInfo(ctx.env, k, head?.size ?? 0),
    file: { type: head?.httpMetadata?.contentType ?? "", bytes: head?.size ?? 0 },
    exif: {},
    basic: true,
  };
}

/**
 * 區塊照片（杜杜龍 2026-11-24）：cover_media 的 course 類，owner_key 除了課程編號，也可以是「區塊編號」（該區塊底下的照片，與中心 EDM 共用上傳模組）。
 * 回傳要檢查權限的課程編號；區塊所屬課程沒有開放（courses.block_photos）就擋下。連結區塊要傳來源區塊編號（照片只存來源一份）。
 */
export async function courseOfCoverKey(db: D1Database, key: string): Promise<string> {
  if (await db.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").bind(key).first()) return key;
  const blk = await db.prepare("SELECT l.course_id, c.block_photos FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ? AND l.kind = 'section'").bind(key).first<{ course_id: string; block_photos: number }>();
  if (!blk) return key;
  if (blk.block_photos !== 1) fail(403, "block_photos_off", "這門課程還沒有開放區塊新增照片");
  return blk.course_id;
}
// 照片張數不設上限（杜杜龍 2026-11-25）。
export async function coverRoom(_db: D1Database, _o: { kind: CoverMediaKind; lookup: string; scope: CoverScope }): Promise<void> {}
export async function addCoverRow(db: D1Database, o: { s: Session; kind: CoverMediaKind; centerKey: string | null; ownerKey: string; scope: CoverScope }, x: { kind: "image" | "video"; r2Key: string; posterKey: string | null; width: number; height: number; durationSec: number; bytes: number; by: string }): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const where = o.kind === "center" ? "owner_kind = 'center' AND center_key = ?" : "owner_kind = ? AND owner_key = ?";
  const st = db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM cover_media WHERE ${where} AND scope = ?`);
  const pos = (await (o.kind === "center" ? st.bind(o.centerKey, o.scope) : st.bind(o.kind, o.ownerKey, o.scope)).first<{ p: number }>())?.p ?? 0;
  await db.batch([
    db.prepare("INSERT INTO cover_media (id, owner_kind, center_key, owner_key, kind, r2_key, poster_key, width, height, duration_sec, bytes, position, created_by, scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, o.kind, o.centerKey, o.ownerKey, x.kind, x.r2Key, x.posterKey, x.width, x.height, x.durationSec, x.bytes, pos, x.by, o.scope),
    db.prepare("UPDATE cover_media SET uploader_name = ?, uploader_avatar = ? WHERE id = ?").bind((o.s.name ?? "").slice(0, 60), o.s.kind === "central" ? (o.s.avatarUrl ?? "").slice(0, 500) : "", id),
    audit(db, x.by, "cover_media.add", o.kind, o.centerKey ?? o.ownerKey, id),
    ...(o.ownerKey.startsWith("rcp:") ? [db.prepare("UPDATE cover_media SET ocr_status = 'skip' WHERE id = ?").bind(id)] : []), // 食譜照片不做文字辨識（只做場景）
  ]);
  return id;
}

/** 縮圖符號的權限：課程＝能編輯那門課的人；系列＝超級管理員；中心＝該中心的編輯者（與中心封面相同）。 */
export async function thumbBadgeTarget(ctx: Ctx, kindRaw: unknown, keyRaw: unknown): Promise<{ s: Session; kind: ThumbBadgeKind; key: string }> {
  const kind = THUMB_BADGE_KINDS.find((k) => k === kindRaw) ?? fail(400, "invalid_kind", "種類不正確");
  const raw = typeof keyRaw === "string" ? keyRaw.trim().slice(0, 100) : "";
  if (!raw) fail(400, "key_required", "缺少對象");
  if (kind === "course") {
    if (!(await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").bind(raw).first())) fail(404, "not_found", "找不到這門課程");
    await requireCourseArt(ctx, requireMember(ctx), raw);
    return { s: requireMember(ctx), kind, key: raw };
  }
  if (kind === "series") {
    const s = requireSuperAdmin(ctx);
    if (!(await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE series = ? LIMIT 1").bind(raw).first())) fail(404, "not_found", "找不到這個系列卡");
    return { s, kind, key: raw };
  }
  const { s, center } = await requireCenterArt(ctx, raw);
  return { s, kind, key: center.key };
}
export async function requireCenterArt(ctx: Ctx, label: string | null): Promise<{ s: Session; center: { key: string; label: string } }> {
  const s = requireMember(ctx);
  const rights = await rightsOf(ctx);
  const want = (label ?? "").trim().slice(0, 100);
  if (!want) fail(400, "center_required", "請先選擇中心");
  if (rights.admin) {
    await assertCentralCenters(ctx, [want]);
    return { s, center: { key: centerKey(want), label: want } };
  }
  const mine = rights.center && centerKey(want) === centerKey(rights.center.label);
  if (!mine || !(rights.staff || rights.editor?.editOthers)) fail(403, "forbidden", "只能修改自己中心的 EDM");
  return { s, center: { key: centerKey(rights.center!.label), label: rights.center!.label } };
}

// ---------- admin: courses & lessons ----------

export const THEMES = ["sage", "rose", "gold", "blue", "clay", "violet"];
export function randomId(n: number): string {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => a[b % a.length]).join("");
}
/** 活動日期：YYYY-MM-DD 或 null（清除）。 */
// ---------- 我的書櫃（杜杜龍 2026-11-17） ----------
export type LibRow = { member_sub: string; number: string; owner_name: string; title: string; pw_hash: string | null; pw_salt: string | null; pw_expires_at: string | null; views: number };
export type LibItemRow = { id: string; kind: "shelf" | "book"; title: string; url: string | null; att_type: AttachmentType | null; event_date: string | null; start_seconds: number | null; end_seconds: number | null; pw_hash: string | null; pw_salt: string | null; pw_expires_at: string | null; position: number };
export const libOf = (db: D1Database, sub: string) => db.prepare("SELECT member_sub, number, owner_name, title, pw_hash, pw_salt, pw_expires_at, views FROM libraries WHERE member_sub = ?").bind(sub).first<LibRow>();
export const libOf2 = (db: D1Database, number: string) => db.prepare("SELECT member_sub, number, owner_name, title, pw_hash, pw_salt, pw_expires_at, views FROM libraries WHERE number = ?").bind(number).first<LibRow>();
export const libItems = async (db: D1Database, sub: string): Promise<LibItemRow[]> =>
  (await db.prepare("SELECT id, kind, title, url, att_type, event_date, start_seconds, end_seconds, pw_hash, pw_salt, pw_expires_at, position FROM library_items WHERE library_sub = ? ORDER BY position").bind(sub).all<LibItemRow>()).results;
export const libItemOut = (r: LibItemRow, owner: boolean, unlocked: boolean): LibraryItem => {
  const locked = !owner && !!r.pw_hash && !unlocked;
  return {
    id: r.id, kind: r.kind, title: r.title, url: locked ? null : r.url, type: r.att_type, eventDate: r.event_date,
    start: locked ? null : r.start_seconds, end: locked ? null : r.end_seconds, locked,
    ...(owner ? { pwSet: !!r.pw_hash, pwExpiresAt: r.pw_expires_at, pwExpired: !!r.pw_hash && !pwActive(r.pw_expires_at) } : {}),
  };
};
/** 建立書櫃（邀請接受、集滿徽章自動解鎖共用）：需要中央會員編號；失敗回傳白話原因。 */
export async function createLibrary(ctx: Ctx, s: Session): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (s.kind !== "central") return { ok: false, code: "central_only", message: "請用會員中心帳號登入" };
  const number = libraryNumber(await memberNumberOf(s.sub, s.token));
  if (!number) return { ok: false, code: "no_member_number", message: "請先到會員中心填寫你的安麗會員編號，再回來" };
  if (await ctx.db.prepare("SELECT 1 AS ok FROM libraries WHERE number = ?").bind(number).first()) return { ok: false, code: "number_taken", message: "這個會員編號的書櫃已經存在（例如配偶共用同一個編號），請洽管理員" };
  await ctx.db.batch([ctx.db.prepare("INSERT INTO libraries (member_sub, number, owner_name, title) VALUES (?, ?, ?, ?)").bind(s.sub, number, s.name, `${s.name}的書櫃`), audit(ctx.db, s.sub, "library.create", "library", s.sub, number)]);
  return { ok: true };
}
export async function libraryMine(ctx: Ctx, sub: string): Promise<LibraryMine> {
  let lib = await libOf(ctx.db, sub);
  let keys: LibraryMine["keys"];
  if (!lib && ctx.session?.kind === "central") {
    // 獲得任意 100 枚徽章就自動解鎖書櫃鑰匙（杜杜龍 2026-11-17）；會員編號等問題留在 blocked 讓畫面提示。
    const have = (await grantAchievements(ctx, sub)).filter((a) => a.earned).length;
    const need = (await loadConfig(ctx.db)).app.libraryKeyBadges ?? LIBRARY_KEY_BADGES;
    keys = { have, need };
    if (have >= need) {
      const r = await createLibrary(ctx, ctx.session);
      if (r.ok) lib = await libOf(ctx.db, sub);
      else keys.blocked = r.message;
    }
  }
  if (!lib) return { library: null, items: [], keys };
  return { library: { number: lib.number, title: lib.title, ownerName: lib.owner_name, views: lib.views, pwSet: !!lib.pw_hash, pwExpiresAt: lib.pw_expires_at, pwExpired: !!lib.pw_hash && !pwActive(lib.pw_expires_at) }, items: (await libItems(ctx.db, sub)).map((r) => libItemOut(r, true, true)) };
}
/** 書櫃密碼欄位：password 字串＝設定（可帶 passwordDays）、null＝關閉密碼、沒傳＝不動。 */
export async function libPwSets(body: { password?: unknown; passwordDays?: unknown }): Promise<[string, unknown][]> {
  if (body.password === undefined) return [];
  if (body.password === null || body.password === "") return [["pw_hash", null], ["pw_salt", null], ["pw_expires_at", null]];
  const chk = checkPasswordInput(body.password, body.passwordDays);
  if (!chk.ok) return fail(400, "invalid_password", chk.message);
  const h = await hashPassword(chk.password);
  return [["pw_hash", h.hash], ["pw_salt", h.salt], ["pw_expires_at", expiresAt(chk.days)]];
}
export async function myLibrary(ctx: Ctx): Promise<{ s: Session; lib: LibRow }> {
  const s = requireMember(ctx);
  const lib = await libOf(ctx.db, s.sub);
  if (!lib) return fail(403, "no_library", "你還沒有「我的書櫃」");
  return { s, lib };
}
export async function libItemBody(ctx: Ctx, body: Record<string, unknown>, kind: "shelf" | "book"): Promise<[string, unknown][]> {
  const sets: [string, unknown][] = [];
  const title = cleanTitle(body.title);
  if (body.title !== undefined) {
    if (!title && kind === "shelf") return fail(400, "title_required", "請輸入書架名稱");
    if (title) sets.push(["title", title]);
  }
  if (kind === "book" && body.url !== undefined) {
    const u = parseHttpsUrl(body.url);
    if (!u) return fail(400, "invalid_url", "請輸入 https 開頭的有效網址");
    sets.push(["url", u.toString()], ["att_type", classifyLink(u)]);
    if (!title && body.title === undefined) sets.push(["title", cleanTitle(await fetchLinkTitle(u)) || LINK_DEFAULT_TITLE[classifyLink(u)]]);
  }
  if (kind === "book") {
    if (body.eventDate !== undefined) sets.push(["event_date", dayOrNull(body.eventDate)]);
    for (const [k, col] of [["startSeconds", "start_seconds"], ["endSeconds", "end_seconds"]] as const) if (body[k] !== undefined) sets.push([col, body[k] === null ? null : Math.max(0, Math.floor(Number(body[k])) || 0)]);
    sets.push(...(await libPwSets(body as { password?: unknown; passwordDays?: unknown })));
  }
  return sets;
}

export const dayOrNull = (v: unknown): string | null =>
  v === null || v === "" ? null : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : fail(400, "invalid_date", "活動日期格式請用 2026-12-01");
export const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

/** 封面裁切框（占 EDM 圖片寬高的比例）：x、y 是左上角，w 是寬；高由 16:9 算出。 */
export type CoverRect = { x: number; y: number; w: number };
export function parseCoverRect(raw: string | null): CoverRect | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<CoverRect>;
    return [r.x, r.y, r.w].every((n) => typeof n === "number" && Number.isFinite(n)) ? (r as CoverRect) : null;
  } catch {
    return null;
  }
}
export async function courseFields(ctx: Ctx, body: Record<string, unknown>, creating: boolean, who: Session) {
  const centerOnly = who.role !== "admin"; // 會長、音控：主辦單位固定是自己的中心，不能自稱總部指導，審核群組只能用自己中心的
  const sets: [string, unknown][] = [];
  // 清單卡（只在建立時決定）：完全公開、免費，沒有主講人與章節。
  if (creating && body.isList === true) sets.push(["is_list", 1], ["is_public", 1], ["price_twd", 0]);
  const t = text(body.title, 120);
  if (t !== undefined) {
    if (!t) fail(400, "title_required", "請輸入課程名稱");
    sets.push(["title", t]);
  } else if (creating) fail(400, "title_required", "請輸入課程名稱");
  if (body.category !== undefined) {
    const raw = Array.isArray(body.category) ? body.category.filter((x): x is string => typeof x === "string").join(CAT_SEP) : typeof body.category === "string" ? body.category : "";
    sets.push(["category", joinCats(splitCats(raw)).slice(0, 120)]);
  }
  for (const [k, col, max] of [["subtitle", "subtitle", 200], ["teacher", "teacher", 60], ["teacherTitle", "teacher_title", 50], ["description", "description", 5000]] as const) {
    const v = text(body[k], max);
    if (v !== undefined) sets.push([col, v]);
    if (k === "teacherTitle" && v) await noteJobTitle(ctx, v);
  }
  const teacherRank = text(body.teacherRank, 40);
  if (teacherRank !== undefined) {
    await assertCentralRank(ctx, teacherRank);
    sets.push(["teacher_rank", teacherRank]);
  }
  // 勾了「無」（沒有主講人、獎銜、職稱；杜杜龍 2026-11-19）：三個欄位一律清空；取消勾選就回到可以填。
  if (body.isPackage !== undefined && !(creating && body.isList === true)) sets.push(["is_package", body.isPackage === true ? 1 : 0]);
  if (body.noSpeaker !== undefined) {
    const no = body.noSpeaker === true;
    for (let i = sets.length - 1; i >= 0 && no; i--) if (["teacher", "teacher_rank", "teacher_title"].includes(sets[i]![0])) sets.splice(i, 1);
    sets.push(["no_speaker", no ? 1 : 0]);
    if (no) sets.push(["teacher", ""], ["teacher_rank", ""], ["teacher_title", ""]);
  }
  if (body.priceTwd !== undefined) {
    const n = Number(body.priceTwd);
    if (!Number.isInteger(n) || n < 0 || n > 10_000_000) fail(400, "invalid_price", "費用請輸入 0 以上的整數");
    sets.push(["price_twd", n]);
  }
  if (body.theme !== undefined) {
    if (!THEMES.includes(String(body.theme))) fail(400, "invalid_theme", "封面顏色不正確");
    sets.push(["theme", body.theme]);
  }
  if (body.minRankCode !== undefined) {
    if (typeof body.minRankCode !== "string" || !(await ranks(ctx.db)).has(body.minRankCode)) fail(400, "invalid_rank", "獎銜不存在");
    sets.push(["min_rank_code", body.minRankCode]);
  }
  if (body.status !== undefined) {
    if (body.status !== "draft" && body.status !== "published" && body.status !== "archived") fail(400, "invalid_status", "狀態不正確");
    sets.push(["status", body.status]);
  }
  if (body.allowPresident !== undefined) sets.push(["allow_president", body.allowPresident === true ? 1 : 0]);
  if (body.inviteOnly !== undefined) sets.push(["invite_only", body.inviteOnly === true ? 1 : 0]);
  if (body.inviteCode !== undefined) sets.push(["invite_code", typeof body.inviteCode === "string" ? body.inviteCode.trim().slice(0, 40) : ""]);
  if (body.viewScope !== undefined) {
    if (!(VIEW_SCOPES as string[]).includes(String(body.viewScope))) fail(400, "invalid_view_scope", "「誰可以瀏覽」的選項不正確");
    sets.push(["view_scope", body.viewScope]);
  } else if (creating && body.isPublic !== undefined) sets.push(["view_scope", body.isPublic === true ? "all" : "members"]);
  if (body.isPublic !== undefined) sets.push(["is_public", body.isPublic === true ? 1 : 0]);
  if (body.priceTba !== undefined) sets.push(["price_tba", body.priceTba === true ? 1 : 0]);
  const loc = text(body.location, 100);
  if (loc !== undefined) sets.push(["location", loc]);
  if (body.locationNone !== undefined) sets.push(["location_none", body.locationNone === true ? 1 : 0]);
  if (body.isOnline !== undefined) sets.push(["is_online", body.isOnline === true ? 1 : 0]);
  if (body.chapterCovers !== undefined) sets.push(["chapter_covers", body.chapterCovers === true ? 1 : 0]);
  if (body.blockPhotos !== undefined) sets.push(["block_photos", body.blockPhotos === true ? 1 : 0]);
  // 短影音專輯：勾了的課程，其章節與影音教材在「單元」頁歸類為短影音。
  if (body.isShorts !== undefined) sets.push(["is_shorts", body.isShorts === true ? 1 : 0]);
  if (body.earlyBird !== undefined) {
    if (body.earlyBird === true) {
      const price = Number(body.earlyPriceTwd);
      const until = body.earlyUntil;
      if (!Number.isInteger(price) || price < 1 || price > 10_000_000) fail(400, "invalid_early_price", "早鳥優惠價請輸入 1 以上的整數");
      if (typeof until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(until) || Number.isNaN(Date.parse(until))) fail(400, "invalid_early_until", "請選擇早鳥優惠的截止日期");
      const base = sets.find(([c]) => c === "price_twd")?.[1];
      if (typeof base === "number" && price >= base) fail(400, "invalid_early_price", "早鳥優惠價必須低於原價");
      sets.push(["early_bird", 1], ["early_price_twd", price], ["early_until", until]);
    } else sets.push(["early_bird", 0], ["early_price_twd", null], ["early_until", null]);
  }
  // 素材的第二層短網址（只有超級管理員）：英文小寫、數字、短橫線；是否重複在儲存時檢查。
  const matUrl = text(body.matUrl, 60);
  if (matUrl !== undefined) {
    if (!who.roles.includes("super_admin")) fail(403, "mat_url_super_admin_only", "只有超級管理員可以設定清單網址");
    const v = matUrl.trim().toLowerCase();
    if (v && !/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])$/.test(v)) fail(400, "invalid_mat_url", "清單網址只能用英文、數字和短橫線（至少 2 個字）");
    if (v && ["edit", "share", "api", "new", "admin", "series", "course", "courses"].includes(v)) fail(400, "reserved_mat_url", "這個名稱是系統保留字，請換一個");
    sets.push(["mat_url", v || null]);
  }
  const series = text(body.series, 60);
  if (series !== undefined) {
    // 設定「系列」只限超級管理員（杜杜龍 2026-11-16）。
    if (!who.roles.includes("super_admin")) fail(403, "series_super_admin_only", "只有超級管理員可以設定系列");
    sets.push(["series", series]);
  }
  if (body.zone !== undefined) {
    // 專區只限超級管理員設定（杜杜龍 2026-11-18）；空字串＝依類型預設。
    if (!who.roles.includes("super_admin")) fail(403, "zone_super_admin_only", "只有超級管理員可以設定專區");
    const z = typeof body.zone === "string" ? body.zone : "";
    if (z && !ZONES.some((x) => x.id === z)) fail(400, "invalid_zone", "專區不正確");
    sets.push(["zone", z]);
  }
  if (body.diamondFree !== undefined) sets.push(["diamond_free", body.diamondFree === true ? 1 : 0]);
  if (body.hideFromHome !== undefined) sets.push(["hide_home", body.hideFromHome === true ? 1 : 0]);
  if (body.brandId !== undefined) {
    const id = typeof body.brandId === "string" ? body.brandId.trim() : "";
    if (id && !(await ctx.db.prepare("SELECT 1 AS ok FROM brand_logos WHERE id = ?").bind(id).first())) fail(400, "invalid_brand", "找不到這個品牌");
    sets.push(["brand_id", id || null]);
  }
  // 封面框與預設停留位置永遠同步：有 coverRect 時，預設位置＝封面框上緣（edm_view_y 由它算出，不接受另外指定）。
  // 只改預設位置（沒有封面框）時，封面框作廢（NULL），免得兩者不一致。
  if (body.coverRect !== undefined) {
    if (body.coverRect === null) sets.push(["cover_rect", null]);
    else {
      const r = body.coverRect as Partial<CoverRect>;
      const ok = r && [r.x, r.y, r.w].every((n) => typeof n === "number" && Number.isFinite(n)) && r.w! > 0 && r.w! <= 1 && r.x! >= 0 && r.x! + r.w! <= 1.0001 && r.y! >= 0 && r.y! <= 1;
      if (!ok) fail(400, "invalid_cover_rect", "封面裁切範圍不正確");
      const rect = { x: Math.round(r.x! * 10000) / 10000, y: Math.round(r.y! * 10000) / 10000, w: Math.round(r.w! * 10000) / 10000 };
      sets.push(["cover_rect", JSON.stringify(rect)], ["edm_view_y", rect.y]);
    }
  } else if (body.edmViewY !== undefined) {
    const y = Number(body.edmViewY);
    if (!Number.isFinite(y) || y < 0 || y > 1) fail(400, "invalid_view", "EDM 預設位置不正確");
    sets.push(["edm_view_y", y], ["cover_rect", null]);
  }
  const guidance = text(body.guidanceUnit, 60);
  if (centerOnly && guidance === HQ_UNIT) fail(403, "forbidden", `指導單位「${HQ_UNIT}」只有總部管理員可以設定`);
  if (guidance !== undefined) sets.push(["guidance_unit", guidance]);
  // 主辦單位可以複選（總部管理員）：存成「、」分隔文字；權限與審核仍以第一個中心（非寰宇總部）為準。
  const hostList = Array.isArray(body.hostUnit)
    ? splitCats(body.hostUnit.filter((x): x is string => typeof x === "string").join(CAT_SEP))
    : typeof body.hostUnit === "string"
      ? splitCats(body.hostUnit)
      : undefined;
  const host = hostList === undefined ? undefined : joinCats(hostList).slice(0, 300);
  if (!centerOnly && hostList) await assertCentralCenters(ctx, hostList.filter((x) => x !== HQ_UNIT));
  if (centerOnly) {
    const center = who.center ?? fail(403, "forbidden", "需要有所屬中心才能管理課程");
    if (creating || host !== undefined) sets.push(["host_unit", center.label], ["host_center_key", center.key]);
  } else if (host !== undefined) {
    const firstCenter = hostList?.find((x) => x !== HQ_UNIT);
    sets.push(["host_unit", host], ["host_center_key", firstCenter ? centerKey(firstCenter) : null]);
  }
  if (body.eventStart !== undefined || body.eventEnd !== undefined) {
    const day = (v: unknown) => (v === null || v === "" || v === undefined ? null : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : fail(400, "invalid_date", "活動日期格式請用 2026-12-01"));
    const start = day(body.eventStart);
    const end = day(body.eventEnd);
    if (end && !start) fail(400, "invalid_date", "請先填活動開始日期");
    if (start && end && end < start) fail(400, "invalid_date", "活動結束日不能早於開始日"); // 連續天數不設上限（杜杜龍 2026-11-19）
    sets.push(["event_start", start], ["event_end", end && end !== start ? end : null]);
  }
  for (const [k, col] of [["freeFrom", "free_from"], ["freeUntil", "free_until"]] as const) {
    const v = isoOrNull(body[k]);
    if (v !== undefined) sets.push([col, v]);
  }
  if (body.reviewGroupId !== undefined) {
    if (body.reviewGroupId === null || body.reviewGroupId === "") sets.push(["review_group_id", null]);
    else {
      const g = await ctx.db.prepare("SELECT owner_center_key FROM review_groups WHERE id = ?").bind(String(body.reviewGroupId)).first<{ owner_center_key: string | null }>();
      if (!g) fail(400, "invalid_group", "審核群組不存在");
      if (centerOnly && g?.owner_center_key !== who.center?.key) fail(403, "forbidden", "只能使用自己中心的審核群組");
      sets.push(["review_group_id", body.reviewGroupId]);
    }
  }
  return sets;
}

/** 指導單位為寰宇總部的課程，只能套用總部群組（由秘書、超級管理員指派審核人員）。 */
export async function checkGuidanceGroup(ctx: Ctx, guidance: unknown, groupId: unknown) {
  if (guidance !== HQ_UNIT || !groupId) return;
  const g = await ctx.db.prepare("SELECT owner_center_key FROM review_groups WHERE id = ?").bind(String(groupId)).first<{ owner_center_key: string | null }>();
  if (g?.owner_center_key) fail(400, "hq_group_required", `指導單位為「${HQ_UNIT}」的課程只能使用總部的審核群組`);
}

/** 完全公開（訪客免登入可看）只限免費課程，避免付費內容被公開。 */
export function checkPublicFree(price: number, isPublic: boolean, tba = false) {
  if (isPublic && tba) fail(400, "public_must_be_free", "費用尚未公布的課程不能設為「完全公開」");
  if (isPublic && price > 0) fail(400, "public_must_be_free", "「完全公開」只能用在免費課程；請先把費用改成 0");
}

/** is_public＝訪客也能看、免費、費用已公布、而且沒有獎銜限制（有獎銜限制＝訪客只能看介紹，不能直接看內容也不能報名；杜杜龍 2026-11-17 規則 B）。 */
export function deriveIsPublic(sets: [string, unknown][], cur: { view_scope: string; price_twd: number; price_tba: number; min_rank_code?: string; invite_only?: number } | null) {
  if (!sets.some(([c]) => ["view_scope", "price_twd", "price_tba", "min_rank_code", "invite_only"].includes(c))) return;
  const pick = (col: string, old: unknown) => (sets.find(([c]) => c === col) ?? [col, old])[1];
  const pub = ["all", "link_guest"].includes(String(pick("view_scope", cur?.view_scope ?? "all"))) && Number(pick("price_twd", cur?.price_twd ?? 0)) === 0 && pick("price_tba", cur?.price_tba ?? 0) !== 1 && String(pick("min_rank_code", cur?.min_rank_code ?? "none")) === "none" && Number(pick("invite_only", cur?.invite_only ?? 0)) !== 1;
  const i = sets.findIndex(([c]) => c === "is_public");
  if (i >= 0) sets.splice(i, 1);
  sets.push(["is_public", pub ? 1 : 0]);
}

export async function createCourse(ctx: Ctx, admin: Session) {
  const body = await readJson<Record<string, unknown>>(ctx.req);
  await withSeriesDefaults(ctx, body); // 系列最後一次「套用到全系列課程」的設定，當新課程的預設值
  const sets = await courseFields(ctx, body, true, admin);
  checkPublicFree(Number(sets.find(([c]) => c === "price_twd")?.[1] ?? 0), sets.find(([c]) => c === "is_public")?.[1] === 1, sets.find(([c]) => c === "price_tba")?.[1] === 1);
  if (!sets.some(([c]) => c === "allow_president")) sets.push(["allow_president", 1]); // 新課程預設「會長不受獎銜限制也可報名」
  if (!sets.some(([c]) => c === "view_scope")) sets.push(["view_scope", "all"]); // 新課程（含清單）預設「所有人含訪客」（杜杜龍 2026-11-17）
  deriveIsPublic(sets, null);
  // 沒有系列的教材卡一律放進「未分類」系列（只有超級管理員看得到；杜杜龍 2026-11-20：必須設定系列才會顯示在課程首頁）。
  if (!String(sets.find(([c]) => c === "series")?.[1] ?? "").trim()) {
    const at = sets.findIndex(([c]) => c === "series");
    if (at >= 0) sets[at] = ["series", UNCATEGORIZED];
    else sets.push(["series", UNCATEGORIZED]);
  }
  await checkGuidanceGroup(ctx, body.guidanceUnit, body.reviewGroupId);
  const id = `c${randomId(7)}`;
  const max = await ctx.db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM courses").first<{ m: number }>();
  // 新課程一律先是草稿（小編也一樣，自己再決定上架）；記下建立者。
  // 新增「清單卡」＝自動直接上架（杜杜龍 2026-11-18）；課程仍先是草稿。
  const isListNew = sets.some(([c, v]) => c === "is_list" && (v === 1 || v === true));
  const status = isListNew || sets.find(([c]) => c === "status")?.[1] === "published" ? "published" : "draft";
  const rest = sets.filter(([c]) => c !== "status");
  const cols = ["id", "sort_order", "status", "created_by_sub", "edited_by_name", "edited_at", ...rest.map(([c]) => c)];
  const vals = [id, (max?.m ?? 0) + 1, status, admin.sub, admin.name.slice(0, 60), iso(), ...rest.map(([, v]) => v)];
  // 新增課程不預設建立第一堂章節（杜杜龍 2026-11-16），章節一律在課程頁按「新增章節」。
  await ctx.db.batch([
    ctx.db.prepare(`INSERT INTO courses (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...vals),
    audit(ctx.db, admin.sub, "course.create", "course", id, String(body.title ?? "")),
  ]);
  await ensureCourseUrl(ctx, id);
  if (status === "published") await notifyNewCourse(ctx, id);
  return courseDetail(ctx, id);
}

/** 中心名稱必須是會員中心清單裡的（行動大學不可自行新增）；示範登入不檢查。 */
/** 獎銜只能是會員中心選單裡的代碼（空字串＝不填）。中央查不到清單時不擋（以免中央暫時故障無法存檔）；測試帳號不檢查。 */
export async function assertCentralRank(ctx: Ctx, code: string): Promise<void> {
  const s = ctx.session;
  if (!code || !s || s.kind !== "central") return;
  const list = await rankOptionList(s.token);
  if (list.length && !list.some((o) => o.value === code)) fail(400, "invalid_rank", "獎銜不在會員中心的選單內");
}

/**
 * 新職稱同步到中央（杜杜龍 2026-11-15）：儲存課程主講人／章節分享者的職稱時，若中央詞庫還沒有這個詞，就放進待送清單並嘗試送出。
 * 失敗、中央還沒開放「新增職稱」都不影響課程儲存，之後再儲存時自動補送。
 */
export async function noteJobTitle(ctx: Ctx, value: string | undefined): Promise<void> {
  const v = (value ?? "").trim();
  try {
    const s = ctx.session;
    if (v && s && s.kind === "central") {
      const known = await centralSuggest(s.token, "job_title", v);
      if (!known.some((x) => x.trim().toLowerCase() === v.toLowerCase())) await ctx.db.prepare("INSERT OR IGNORE INTO job_title_outbox (value) VALUES (?)").bind(v).run();
    }
    const { results } = await ctx.db.prepare("SELECT value FROM job_title_outbox WHERE tries < 30 ORDER BY created_at LIMIT 5").all<{ value: string }>();
    for (const r of results) {
      const out = await centralAddJobTitle(ctx.env.CENTRAL_SERVICE_SECRET, r.value);
      if (out === "ok" || out === "rejected") await ctx.db.prepare("DELETE FROM job_title_outbox WHERE value = ?").bind(r.value).run(); // 被中央退回（400／403）的不重送
      else if (out === "retry") await ctx.db.prepare("UPDATE job_title_outbox SET tries = tries + 1 WHERE value = ?").bind(r.value).run();
      else break; // 中央還沒開放：不用一直試
    }
  } catch {
    /* 不影響儲存 */
  }
}

export async function assertCentralCenters(ctx: Ctx, labels: string[]): Promise<void> {
  const s = ctx.session;
  if (!s || s.kind !== "central" || !labels.length) return;
  const list = await centerList(s.token);
  if (!list.length) fail(503, "central_unavailable", UPGRADING_MSG);
  const known = new Set(list.map(centerKey));
  const bad = labels.find((l) => !known.has(centerKey(l)));
  if (bad) fail(400, "unknown_center", `「${bad}」不在會員中心的中心清單裡；中心名稱以會員中心為準，行動大學不能自行新增`);
}

/** 分類可以複選：存成「、」分隔的文字（例如「達標班、會議」）。 */
export const CAT_SEP = "、";
export const splitCats = (v: string): string[] => [...new Set(v.split(/[、,，;；\n]+/).map((x) => x.trim()).filter(Boolean))];
export const joinCats = (list: string[]): string => list.join(CAT_SEP);

// ---------- 關鍵字（分類、系列、場地）：超級管理員集中管理 ----------
export const KEYWORD_COLUMN = { category: "category", series: "series", location: "location" } as const;
export type KeywordKind = keyof typeof KEYWORD_COLUMN;
export const keywordKind = (v: unknown): KeywordKind => (v === "category" || v === "series" || v === "location" ? v : fail(400, "invalid_kind", "關鍵字類型不正確"));
export const keywordText = (v: unknown): string => {
  const t = typeof v === "string" ? v.trim().slice(0, 60) : "";
  return t || fail(400, "invalid_keyword", "請輸入關鍵字");
};

/** 課程編輯頁「已有的…」選項：課程已經用過的值＋超級管理員預先建立的（centerKey 不為 null 時，已用過的只算自己中心的課程）。 */
export async function keywordChoices(ctx: Ctx, kind: KeywordKind, centerKey: string | null): Promise<string[]> {
  const col = KEYWORD_COLUMN[kind];
  const used = await ctx.db
    .prepare(`SELECT DISTINCT ${col} AS v FROM courses WHERE ${col} <> ''${centerKey !== null ? " AND host_center_key = ?" : ""}`)
    .bind(...(centerKey !== null ? [centerKey] : []))
    .all<{ v: string }>();
  const preset = await ctx.db.prepare("SELECT value AS v FROM keywords WHERE kind = ?").bind(kind).all<{ v: string }>();
  const usedValues = kind === "category" ? used.results.flatMap((r) => splitCats(r.v)) : used.results.map((r) => r.v);
  return [...new Set([...usedValues, ...preset.results.map((r) => r.v)])].sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

/** 把每門課的分類清單用 fn 改寫（改名、刪除用），只產生真的有變動的更新。 */
export async function rewriteCategories(ctx: Ctx, fn: (list: string[]) => string): Promise<D1PreparedStatement[]> {
  const { results } = await ctx.db.prepare("SELECT id, category FROM courses WHERE category <> ''").all<{ id: string; category: string }>();
  return results.flatMap((r) => {
    const next = fn(splitCats(r.category));
    return next === r.category ? [] : [ctx.db.prepare("UPDATE courses SET category = ? WHERE id = ?").bind(next, r.id)];
  });
}

export type ShortLinkItem = { kind: "category" | "series" | "center"; value: string; slug: string | null };
/** 短網址設定清單：所有分類與系列（含還沒設定縮寫的），各帶目前的縮寫。 */
export async function aiModelsView(ctx: Ctx) {
  return { jobs: AI_JOBS, models: AI_MODELS, selection: await loadSelection(ctx.db), usage: await usageSummary(ctx.db), keys: keyStatuses(ctx.env) };
}

/** 縮寫 → 它指向的分類／系列／中心；現在的縮寫優先，找不到再看「改名前的舊縮寫」（舊網址永遠有效）。 */
export async function slugTarget(db: D1Database, slug: string, kind?: string): Promise<{ kind: string; value: string } | null> {
  const cond = kind ? " AND kind = ?" : "";
  const bind = kind ? [slug, kind] : [slug];
  return (
    (await db.prepare(`SELECT kind, value FROM short_links WHERE slug = ? COLLATE NOCASE${cond}`).bind(...bind).first<{ kind: string; value: string }>()) ??
    (await db.prepare(`SELECT kind, value FROM short_link_aliases WHERE slug = ? COLLATE NOCASE${cond}`).bind(...bind).first<{ kind: string; value: string }>())
  );
}

export async function listShortLinks(ctx: Ctx): Promise<ShortLinkItem[]> {
  const [kw, links] = await Promise.all([listKeywords(ctx), ctx.db.prepare("SELECT slug, kind, value FROM short_links").all<{ slug: string; kind: string; value: string }>()]);
  const slugOf = new Map(links.results.map((r) => [`${r.kind}:${r.value}`, r.slug]));
  const out: ShortLinkItem[] = [];
  for (const kind of ["category", "series"] as const) for (const k of kw[kind]) out.push({ kind, value: k.value, slug: slugOf.get(`${kind}:${k.value}`) ?? null });
  // 中心：課程的主辦中心（名稱在寫入時已確認是會員中心清單內的）＋已上傳 EDM 或已設定短網址的中心。
  const hosts = await ctx.db.prepare("SELECT DISTINCT host_unit AS v FROM courses WHERE host_center_key IS NOT NULL").all<{ v: string }>();
  const arts = await ctx.db.prepare("SELECT center_label AS v FROM center_art").all<{ v: string }>();
  const centers = new Set([...hosts.results.map((r) => hostCenterOf(r.v)), ...arts.results.map((r) => r.v), ...links.results.filter((r) => r.kind === "center").map((r) => r.value)].filter(Boolean));
  for (const v of [...centers].sort((a, b) => a.localeCompare(b, "zh-Hant"))) out.push({ kind: "center", value: v, slug: slugOf.get(`center:${v}`) ?? null });
  return out;
}

export type KeywordItem = { value: string; count: number; preset: boolean; edmUrl?: string | null };
export async function listKeywords(ctx: Ctx): Promise<Record<KeywordKind, KeywordItem[]>> {
  const out = {} as Record<KeywordKind, KeywordItem[]>;
  for (const kind of Object.keys(KEYWORD_COLUMN) as KeywordKind[]) {
    const col = KEYWORD_COLUMN[kind];
    const [used, preset] = await Promise.all([
      ctx.db.prepare(`SELECT ${col} AS v, COUNT(*) AS n FROM courses WHERE ${col} <> '' GROUP BY ${col}`).all<{ v: string; n: number }>(),
      ctx.db.prepare("SELECT value AS v FROM keywords WHERE kind = ?").bind(kind).all<{ v: string }>(),
    ]);
    const map = new Map<string, KeywordItem>();
    for (const r of used.results) {
      for (const v of kind === "category" ? splitCats(r.v) : [r.v]) map.set(v, { value: v, count: (map.get(v)?.count ?? 0) + r.n, preset: false });
    }
    for (const r of preset.results) map.set(r.v, { value: r.v, count: map.get(r.v)?.count ?? 0, preset: true });
    if (kind === "series") {
      const art = await ctx.db.prepare("SELECT series, edm_key, art_version FROM series_art").all<{ series: string; edm_key: string; art_version: number }>();
      for (const a of art.results) {
        const it = map.get(a.series) ?? { value: a.series, count: 0, preset: true };
        map.set(a.series, { ...it, edmUrl: pubUrl(a.edm_key, a.art_version) });
      }
    }
    out[kind] = [...map.values()].sort((a, b) => a.value.localeCompare(b.value, "zh-Hant"));
  }
  return out;
}

/** 複製這門課，建立下一梯：基本資料、章節架構照搬；活動日期、早鳥與限時免費、EDM／封面、附件、音檔不帶（避免共用同一份檔案）。新課程是草稿。 */
export async function duplicateCourse(ctx: Ctx, id: string, admin: Session) {
  const row = await ctx.db.prepare("SELECT * FROM courses WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!row) return fail(404, "not_found", "找不到這門課程");
  const { results: lessons } = await ctx.db
    .prepare("SELECT title, sharer, sharer_rank, sharer_title, position, duration_minutes, media_type, media_ref, start_seconds, end_seconds, kind, is_full FROM lessons WHERE course_id = ? ORDER BY position")
    .bind(id)
    .all<{ title: string; sharer: string; sharer_rank: string; sharer_title: string; position: number; duration_minutes: number; media_type: MediaType; media_ref: string | null; start_seconds: number | null; end_seconds: number | null; kind: string; is_full: number }>();
  const newId = `c${randomId(7)}`;
  const series = String(row.series || "").trim() || String(row.title ?? "").slice(0, 60);
  const max = await ctx.db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM courses").first<{ m: number }>();
  const keep = ["zone", "view_scope", "subtitle", "teacher", "teacher_rank", "teacher_title", "no_speaker", "is_package", "category", "price_twd", "min_rank_code", "theme", "description", "guidance_unit", "host_unit", "host_center_key", "review_group_id", "allow_president", "is_public", "price_tba", "hide_home", "brand_id", "diamond_free", "location", "location_none", "is_online", "chapter_covers", "auto_cover", "center_course"];
  const cols = ["id", "sort_order", "status", "title", "series", "created_by_sub", "edited_by_name", "edited_at", ...keep];
  const vals = [newId, (max?.m ?? 0) + 1, "draft", `${String(row.title ?? "")}（複製）`.slice(0, 120), series, admin.sub, admin.name.slice(0, 60), iso(), ...keep.map((k) => row[k] ?? null)];
  const stmts: D1PreparedStatement[] = [
    ctx.db.prepare(`INSERT INTO courses (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...vals),
    ...lessons.map((l) => {
      const audio = l.media_type === "audio"; // 音檔是這門課自己的檔案，不共用
      return ctx.db
        .prepare("INSERT INTO lessons (id, course_id, position, title, sharer, sharer_rank, sharer_title, duration_minutes, media_type, media_ref, start_seconds, end_seconds, kind, is_full) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(`${newId}-${randomId(6)}`, newId, l.position, l.title, l.sharer, l.sharer_rank, l.sharer_title, audio ? 0 : l.duration_minutes, audio ? "demo" : l.media_type, audio ? null : l.media_ref, audio ? null : l.start_seconds, audio ? null : l.end_seconds, l.kind, l.is_full);
    }),
    audit(ctx.db, admin.sub, "course.duplicate", "course", newId, id),
  ];
  if (!String(row.series || "").trim()) stmts.push(ctx.db.prepare("UPDATE courses SET series = ? WHERE id = ?").bind(series, id));
  await ctx.db.batch(stmts);
  return courseDetail(ctx, newId);
}

/** 把課程的「名稱、主講人、獎銜、職稱」套到這門課的主講人章節（沒有主講人章節就不動）。 */

export async function updateCourse(ctx: Ctx, id: string) {
  return updateCourseWith(ctx, id, await readJson<Record<string, unknown>>(ctx.req));
}
/** 儲存課程設定的核心（單一課程儲存與「套用到全系列課程」共用）；light＝不重建整份課程資料（批次套用用）。 */
export async function updateCourseWith(ctx: Ctx, id: string, body: Record<string, unknown>, light = false) {
  const { s: admin, can } = await courseRightsFor(ctx, id);
  const cur = await ctx.db.prepare("SELECT invite_only, status, view_scope, url_name, series, mat_url, host_center_key, guidance_unit, review_group_id, price_twd, is_public, price_tba, min_rank_code, updated_at, edited_by_name, event_start, event_end, location, title, is_list, teacher, no_speaker, zone FROM courses WHERE id = ?").bind(id).first<{ invite_only: number; zone: string | null; event_start: string | null; event_end: string | null; location: string | null; title: string; is_list: number; teacher: string | null; no_speaker: number; status: string; view_scope: string; url_name: string | null; series: string; mat_url: string | null; host_center_key: string | null; guidance_unit: string; review_group_id: string | null; price_twd: number; is_public: number; min_rank_code: string; price_tba: number; updated_at: string; edited_by_name: string }>();
  if (!cur) return fail(404, "not_found", "找不到這門課程");
  // 狀態：下架封存要「刪除」權限；從封存還原只有總部、會長、音控；其餘修改要「修改」權限。
  const onlyStatus = Object.keys(body).every((k) => k === "status" || k === "ifUpdatedAt" || k === "force");
  if (body.status === "archived" && cur.status !== "archived") {
    if (!can.remove) fail(403, "forbidden", "沒有下架封存這門課程的權限");
  } else if (cur.status === "archived" && body.status !== undefined && body.status !== "archived") {
    if (!can.restore) fail(403, "forbidden", "還原封存的課程只有總部、會長與音控可以做");
  } else if (!can.edit) fail(403, "forbidden", "沒有修改這門課程的權限");
  if (!onlyStatus && !can.edit) fail(403, "forbidden", "沒有修改這門課程的權限");
  // 別人剛改過：帶 ifUpdatedAt 的儲存，若資料已被改過就先提醒（force 仍要覆蓋）。
  if (typeof body.ifUpdatedAt === "string" && body.ifUpdatedAt !== cur.updated_at && body.force !== true)
    fail(409, "edit_conflict", `這門課程剛被${cur.edited_by_name || "其他管理者"}修改過，請重新載入後再改，或選擇仍要覆蓋`);
  const sets = await courseFields(ctx, body, false, admin);
  if (!sets.length) fail(400, "nothing_to_update", "沒有要更新的欄位");
  // 換了主辦中心：專屬網址在新中心底下重新產生（主辦中心沒變就維持原網址）。
  const newHost = sets.find(([c]) => c === "host_center_key");
  const aliasStmts: D1PreparedStatement[] = [];
  const keepOld = (reason: string) => {
    // 舊網址存成別名：之前分享出去的連結照樣打得開（開啟後網址列會自動換成新的）。
    if (cur.url_name) aliasStmts.push(ctx.db.prepare("INSERT OR REPLACE INTO course_url_aliases (scope, url_name, course_id) VALUES (?, ?, ?)").bind(cur.host_center_key ? centerKey(cur.host_center_key) : "", cur.url_name, id));
    sets.push(["url_name", null]);
    void reason;
  };
  if (newHost && newHost[1] !== cur.host_center_key) keepOld("host");
  else {
    // 主講人改了（或勾了「無」改用課程名稱）：專屬網址（/中心縮寫/英譯-編號）跟著換；英譯結果一樣（只是改錯字等）就不動。
    const setVal = (col: string) => sets.find(([c]) => c === col)?.[1];
    const noNow = (setVal("no_speaker") ?? cur.no_speaker) === 1;
    const touched = sets.some(([c]) => c === "teacher" || c === "no_speaker" || (c === "title" && noNow));
    if (touched && cur.url_name) {
      const src = noNow ? String(setVal("title") ?? cur.title) : String(setVal("teacher") ?? cur.teacher ?? "");
      const base = noNow ? romanizeTitle(src) : src.trim() ? romanizeName(src) : "";
      const oldBase = cur.url_name.replace(/-\d+$/, "");
      if (base && base.toLowerCase() !== oldBase.toLowerCase()) keepOld("name");
    }
  }
  const pick = (col: string, old: unknown) => (sets.find(([c]) => c === col) ?? [col, old])[1];
  // 付費課程的邀請碼：目前只有超級管理員能設定（杜杜龍 2026-11-20）；免費課程由有編輯權的人設定。
  if (sets.some(([c]) => c === "invite_code") && (Number(pick("price_twd", cur.price_twd)) > 0 || pick("price_tba", cur.price_tba) === 1) && !admin.roles.includes("super_admin")) fail(403, "invite_code_super_admin", "付費課程的邀請碼只有超級管理員可以設定");
  const legacyPublic = body.isPublic !== undefined && body.viewScope === undefined;
  if (legacyPublic) {
    // 舊寫法：isPublic true＝所有人；false 只在原本是「所有人」時改成「所有會員」。
    checkPublicFree(Number(pick("price_twd", cur.price_twd)), body.isPublic === true, pick("price_tba", cur.price_tba) === 1);
    if (body.isPublic === true) sets.push(["view_scope", "all"]);
    else if (cur.view_scope === "all") sets.push(["view_scope", "members"]);
  }
  deriveIsPublic(sets, cur);
  const serSet = sets.find(([c]) => c === "series");
  if (serSet && !String(serSet[1] ?? "").trim() && cur.zone !== "amway_brand") serSet[1] = UNCATEGORIZED; // 清掉系列＝回到「未分類」（品牌卡不受影響，它們本來就沒有系列）
  // 清單網址：同一個系列內不可重複（也不能撞到別份素材改名前的舊網址）；改名後舊網址記進別名永遠有效。
  const matSet = sets.find(([c]) => c === "mat_url");
  const matAlias: D1PreparedStatement[] = [];
  if (matSet) {
    const newName = matSet[1] as string | null;
    const ser = String(pick("series", cur.series) ?? "");
    if (newName) {
      const clash = await ctx.db.prepare("SELECT id FROM courses WHERE series = ? AND mat_url = ? COLLATE NOCASE AND id <> ? UNION SELECT course_id FROM material_url_aliases WHERE series = ? AND name = ? COLLATE NOCASE AND course_id <> ?").bind(ser, newName, id, ser, newName, id).first();
      if (clash) fail(400, "mat_url_taken", "這個清單網址已被這個系列的其他清單卡使用，請換一個");
    }
    if (cur.mat_url && cur.mat_url !== newName) matAlias.push(ctx.db.prepare("INSERT OR IGNORE INTO material_url_aliases (series, name, course_id) VALUES (?, ?, ?)").bind(cur.series, cur.mat_url, id));
  }
  await checkGuidanceGroup(ctx, pick("guidance_unit", cur.guidance_unit), pick("review_group_id", cur.review_group_id));
  const batchRes = await ctx.db.batch([
    ...matAlias,
    ...aliasStmts,
    ctx.db.prepare(`UPDATE courses SET ${sets.map(([c]) => `${c} = ?`).join(", ")}, updated_at = ?, edited_by_name = ?, edited_at = ? WHERE id = ?`).bind(...sets.map(([, v]) => v), iso(), admin.name.slice(0, 60), iso(), id),
    // 主講人章節的名稱、分享者、獎銜、職稱永遠等於課程基本資料：課程改了就一起同步。
    audit(ctx.db, admin.sub, "course.update", "course", id, sets.map(([c]) => c).join(",")),
  ]);
  const res = batchRes[matAlias.length + aliasStmts.length]!;
  if (res.meta?.changes === 0) fail(404, "not_found", "找不到這門課程");
  // 專區跟著「系列」走：同一個系列的課程一起換專區，避免同一張卡拆在兩個專區。
  const zoneSet = sets.find(([c]) => c === "zone");
  const serNow = String(pick("series", cur.series) ?? "");
  if (zoneSet && serNow && serNow !== UNCATEGORIZED) await ctx.db.prepare("UPDATE courses SET zone = ? WHERE series = ?").bind(zoneSet[1], serNow).run();
  await ensureCourseUrl(ctx, id);
  if (pick("status", cur.status) === "published" && cur.status !== "published") await notifyNewCourse(ctx, id);
  // 上課日期或地點改了：已報名的學員收到更新通知（報名＝訂閱，杜杜龍 2026-11-18）。
  const changed = (col: "event_start" | "event_end" | "location") => sets.some(([c, v]) => c === col && v !== cur[col]);
  if (cur.is_list !== 1 && cur.status === "published" && (changed("event_start") || changed("event_end") || changed("location"))) {
    await notifyEnrolled(ctx.db, id, `${cur.title.slice(0, 40)}時間或地點有更新`, "請打開課程頁確認最新的日期與地點", `/course/${id}`, admin.sub, null).catch(() => undefined);
  }
  return light ? ({ ok: true } as unknown as CourseDetail) : courseDetail(ctx, id);
}

export async function renumber(db: D1Database, courseId: string) {
  const { results } = await db.prepare("SELECT id FROM lessons WHERE course_id = ? ORDER BY position").bind(courseId).all<{ id: string }>();
  await db.batch([
    db.prepare("UPDATE lessons SET position = -position WHERE course_id = ?").bind(courseId),
    ...results.map((r, i) => db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(i + 1, r.id)),
  ]);
}

export const seconds = (v: unknown): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 24 * 3600) fail(400, "invalid_time", "時間格式不正確");
  return n;
};

/** 修改章節：名稱、影片來源（示範／YouTube／Mux）、時間軸區間。音檔由上傳流程設定。 */
/** 區塊的品牌（單選）與分類（可複選）。 */
export async function blockBrand(ctx: Ctx, v: unknown): Promise<string | null> {
  const id = typeof v === "string" ? v.trim() : "";
  if (!id) return null;
  if (!(await ctx.db.prepare("SELECT 1 AS ok FROM brand_logos WHERE id = ?").bind(id).first())) fail(400, "invalid_brand", "找不到這個品牌");
  return id;
}
export const blockCats = (v: unknown): string => (Array.isArray(v) ? joinCats(splitCats(v.filter((x): x is string => typeof x === "string").join(CAT_SEP))) : typeof v === "string" ? joinCats(splitCats(v)) : "").slice(0, 120);
/** 「主題」（原主講人標記）：每個區塊（或最前面還沒歸區塊的教材）只能有一個，勾新的時原本那個自動取消。 */
export function clearThemeInBlock(db: D1Database, courseId: string, id: string): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE lessons SET is_speaker = 0 WHERE course_id = ?1 AND kind = 'material' AND is_speaker = 1 AND id <> ?2 AND position > COALESCE((SELECT MAX(position) FROM lessons WHERE course_id = ?1 AND kind = 'section' AND position < (SELECT position FROM lessons WHERE id = ?2)), -1) AND position < COALESCE((SELECT MIN(position) FROM lessons WHERE course_id = ?1 AND kind = 'section' AND position > (SELECT position FROM lessons WHERE id = ?2)), 1000000000)",
    )
    .bind(courseId, id);
}
export async function updateLesson(ctx: Ctx, id: string, admin: Session) {
  const body = await readJson<{ isSpeaker?: unknown; isSummary?: unknown; eventDate?: unknown; title?: unknown; sharer?: unknown; sharerRank?: unknown; sharerTitle?: unknown; mediaType?: unknown; mediaRef?: unknown; minutes?: unknown; startSeconds?: unknown; endSeconds?: unknown; inSheet?: unknown; brandId?: unknown; categories?: unknown }>(ctx.req);
  if (body.mediaType === "mux" && !admin.roles.includes("super_admin")) fail(403, "forbidden", "Mux 影片只有超級管理員可以設定，請改用 YouTube 或音檔");
  const cur = await ctx.db
    .prepare("SELECT course_id, kind, is_speaker, is_summary, media_type, media_ref, start_seconds, end_seconds FROM lessons WHERE id = ?")
    .bind(id)
    .first<{ course_id: string; kind: string; is_speaker: number; is_summary: number; media_type: MediaType; media_ref: string | null; start_seconds: number | null; end_seconds: number | null }>();
  if (!cur) return fail(404, "not_found", "找不到這個章節");
  const sets: [string, unknown][] = [];
  // 主講人：同一門課只能有一堂；勾新的這堂時，原本那堂自動取消（轉移）。教材不能當主講人。
  const clearSpeaker: D1PreparedStatement[] = [];
  if (body.isSpeaker !== undefined) {
    if (body.isSpeaker === true && cur.kind === "section") fail(400, "speaker_chapter_only", "區塊不能設為主題");
    if (body.isSpeaker === true) {
      if (cur.kind === "chapter") clearSpeaker.push(ctx.db.prepare("UPDATE lessons SET is_speaker = 0 WHERE course_id = ? AND kind = 'chapter' AND is_speaker = 1 AND id <> ?").bind(cur.course_id, id));
      else clearSpeaker.push(clearThemeInBlock(ctx.db, cur.course_id, id));
    }
    sets.push(["is_speaker", body.isSpeaker === true ? 1 : 0]);
    if (body.isSpeaker === true && body.isSummary === undefined && cur.kind === "chapter") sets.push(["is_summary", 0]); // 與「總結與銷售課程」互斥
  }
  // 總結與銷售課程：同一門課只能有一堂（勾新的，原本那堂轉移）；與主講人互斥；只有章節可以勾。
  const clearSummary: D1PreparedStatement[] = [];
  if (body.isSummary !== undefined) {
    if (body.isSummary === true && body.isSpeaker === true) fail(400, "summary_speaker_exclusive", "主講人與總結與銷售課程不能同時勾選");
    if (body.isSummary === true && cur.kind !== "chapter") fail(400, "summary_chapter_only", "只有章節可以設為總結與銷售課程");
    if (body.isSummary === true) {
      clearSummary.push(ctx.db.prepare("UPDATE lessons SET is_summary = 0 WHERE course_id = ? AND is_summary = 1 AND id <> ?").bind(cur.course_id, id));
      if (body.isSpeaker === undefined) sets.push(["is_speaker", 0]);
    }
    sets.push(["is_summary", body.isSummary === true ? 1 : 0]);
  }
  const title = text(body.title, 120);
  if (title !== undefined) {
    if (!title) fail(400, "title_required", "請輸入章節名稱");
    sets.push(["title", title]);
  }
  if (cur.kind === "section") {
    if (body.inSheet !== undefined) sets.push(["in_sheet", body.inSheet === false ? 0 : 1]);
    if (body.brandId !== undefined) sets.push(["brand_id", await blockBrand(ctx, body.brandId)]);
    if (body.categories !== undefined) sets.push(["categories", blockCats(body.categories)]);
  }
  const sharer = text(body.sharer, 60);
  if (sharer !== undefined) sets.push(["sharer", sharer]);
  const sharerTitle = text(body.sharerTitle, 50);
  if (sharerTitle !== undefined) sets.push(["sharer_title", sharerTitle]);
  if (sharerTitle) await noteJobTitle(ctx, sharerTitle);
  const sharerRank = text(body.sharerRank, 40);
  if (sharerRank !== undefined) {
    await assertCentralRank(ctx, sharerRank);
    sets.push(["sharer_rank", sharerRank]);
  }
  if (body.eventDate !== undefined) sets.push(["event_date", dayOrNull(body.eventDate)]);
  let type = cur.media_type;
  if (body.mediaType !== undefined) {
    const t = body.mediaType;
    const ref = typeof body.mediaRef === "string" ? body.mediaRef.trim() : "";
    if (t !== "demo" && t !== "youtube" && t !== "mux") fail(400, "invalid_media", "影片來源不正確");
    let mediaRef: string | null = null;
    if (t === "youtube") mediaRef = youtubeId(ref) ?? fail(400, "invalid_youtube", "請貼上 YouTube 影片網址或 11 碼影片 ID");
    else if (t === "mux") {
      if (!/^[A-Za-z0-9]{10,80}$/.test(ref)) fail(400, "invalid_mux", "請從 Mux 選擇影片");
      mediaRef = ref;
    }
    type = t as MediaType;
    sets.push(["media_type", t], ["media_ref", mediaRef], ["yt_checked_at", null]);
  }
  const start = seconds(body.startSeconds);
  const end = seconds(body.endSeconds);
  const finalStart = start === undefined ? cur.start_seconds : start;
  const finalEnd = end === undefined ? cur.end_seconds : end;
  if (finalStart != null && finalEnd != null && finalEnd <= finalStart) fail(400, "invalid_range", "結束時間必須晚於開始時間");
  if (start !== undefined) sets.push(["start_seconds", start]);
  if (end !== undefined) sets.push(["end_seconds", end]);
  const minutes = body.minutes === undefined ? undefined : Number(body.minutes);
  if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 0 || minutes > 1000)) fail(400, "invalid_minutes", "影片長度不正確");
  // 有設定區間時，章節長度＝區間長度（分鐘，無條件進位）。
  if (finalEnd != null && (start !== undefined || end !== undefined)) sets.push(["duration_minutes", Math.max(1, Math.ceil((finalEnd - (finalStart ?? 0)) / 60))]);
  else if (minutes !== undefined) sets.push(["duration_minutes", minutes]);
  if (!sets.length) fail(400, "nothing_to_update", "沒有要更新的欄位");
  // 主講人章節的名稱、分享者、獎銜、職稱一律等於課程基本資料（不接受另外填的值）。
  // 「總結」章節的名稱固定就是「總結」（杜杜龍 2026-11-16）：勾選當下與之後的每次修改，伺服器都強制。
  const nowSummary = body.isSummary === undefined ? cur.is_summary === 1 && body.isSpeaker !== true : body.isSummary === true;
  const speakerSets = sets;
  const finalSets: [string, unknown][] = nowSummary ? [...speakerSets.filter(([c]) => c !== "title"), ["title", SUMMARY_TITLE]] : speakerSets;
  await ctx.db.batch([
    ...clearSpeaker,
    ...clearSummary,
    ...(finalSets.length ? [ctx.db.prepare(`UPDATE lessons SET ${finalSets.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`).bind(...finalSets.map(([, v]) => v), id)] : []),
    audit(ctx.db, admin.sub, "lesson.update", "lesson", id, sets.map(([c]) => c).join(",")),
  ]);
  if (cur.media_type === "audio" && type !== "audio" && cur.media_ref) await ctx.env.MEDIA?.delete(cur.media_ref).catch(() => undefined);
  const row = await ctx.db.prepare("SELECT media_type, media_ref FROM lessons WHERE id = ?").bind(id).first<{ media_type: string; media_ref: string | null }>();
  return { ok: true, mediaType: row?.media_type, mediaRef: row?.media_ref };
}

// ---------- 審核群組、通知範圍 ----------

/** 這位登入者看得到的通知：自己的、（管理員）寄給總部的、（會長）寄給自己中心會長的。 */
export function noticeScope(s: Session): { sql: string; args: unknown[] } {
  const parts = ["recipient_sub = ?"];
  const args: unknown[] = [s.sub];
  if (s.role === "admin") parts.push("recipient_role = 'admin'");
  if (s.roles.includes("president") && s.center) {
    parts.push("(recipient_role = 'president' AND recipient_center_key = ?)");
    args.push(s.center.key);
  }
  return { sql: `(${parts.join(" OR ")})`, args };
}

/** 中心自辦群組：該中心的會長、音控可管理。 */
export const canManageCenter = (s: Session, key: string) => !!s.center && s.center.key === key && (s.roles.includes("president") || s.roles.includes("sound"));

export async function requireGroupManager(ctx: Ctx, groupId: string): Promise<Session> {
  const s = requireMember(ctx);
  const g = await ctx.db.prepare("SELECT owner_center_key FROM review_groups WHERE id = ?").bind(groupId).first<{ owner_center_key: string | null }>();
  if (!g) return fail(404, "not_found", "找不到這個審核群組");
  // 總部群組（owner_center_key 為 NULL）只有秘書與超級管理員可以指派。
  if (s.role !== "admin" && !(g.owner_center_key && canManageCenter(s, g.owner_center_key))) fail(403, "forbidden", "沒有管理這個群組的權限");
  return s;
}

export async function listGroups(ctx: Ctx): Promise<ReviewGroup[]> {
  const s = requireMember(ctx);
  const manager = s.role === "admin" || s.roles.includes("president") || s.roles.includes("sound");
  // 小編：只能「選用」自己中心的群組（課程設定用），不能管理群組。
  const rights = await rightsOf(ctx);
  if (!manager && !rights.any) fail(403, "forbidden", "沒有管理審核群組的權限");
  const [g, m, c] = await ctx.db.batch([
    ctx.db.prepare("SELECT id, name, owner_center_key, owner_center_label FROM review_groups ORDER BY created_at"),
    ctx.db.prepare("SELECT group_id, center_key, center_label, member_sub, member_name, duty FROM review_group_members ORDER BY center_label, created_at"),
    ctx.db.prepare("SELECT id, title, review_group_id FROM courses WHERE review_group_id IS NOT NULL"),
  ]);
  type G = { id: string; name: string; owner_center_key: string | null; owner_center_label: string };
  type M = { group_id: string; center_key: string; center_label: string; member_sub: string; member_name: string; duty: Duty };
  return (g.results as G[])
    .filter((x) => s.role === "admin" || (x.owner_center_key && (canManageCenter(s, x.owner_center_key) || rights.centerKeys.has(x.owner_center_key))))
    .map((x) => ({
      id: x.id,
      name: x.name,
      ownerCenter: x.owner_center_key ? x.owner_center_label : null,
      courses: (c.results as { id: string; title: string; review_group_id: string }[]).filter((k) => k.review_group_id === x.id).map((k) => ({ id: k.id, title: k.title })),
      members: (m.results as M[]).filter((k) => k.group_id === x.id).map((k) => ({ centerKey: k.center_key, centerLabel: k.center_label, memberSub: k.member_sub, memberName: k.member_name, duty: k.duty })),
      canManage: s.role === "admin" || (!!x.owner_center_key && canManageCenter(s, x.owner_center_key)),
    }));
}

export const isoOrNull = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) fail(400, "invalid_date", "日期格式不正確");
  return d.toISOString();
};

// ---------- 課程留言板 ----------

export type CommentRow = { id: string; course_id: string; member_sub: string; member_name: string; body: string; status: "visible" | "hidden"; created_at: string; reports?: number; course_title?: string };
export const toComment = (r: CommentRow, s: Session): CourseComment => ({
  id: r.id,
  courseId: r.course_id,
  authorName: r.member_name,
  mine: r.member_sub === s.sub,
  body: r.body,
  hidden: r.status === "hidden",
  createdAt: r.created_at,
  ...(r.reports !== undefined ? { reports: r.reports, courseTitle: r.course_title } : {}),
});

export async function requireCourseForComments(ctx: Ctx, courseId: string): Promise<Session> {
  const s = requireMember(ctx);
  const c = await ctx.db.prepare("SELECT status FROM courses WHERE id = ?").bind(courseId).first<{ status: string }>();
  // 未上架的課程不開放留言；下架封存的課程，已報名的學員照常可以看與留言。
  if (!c || (c.status === "draft" && s.role !== "admin")) fail(404, "not_found", "找不到這門課程");
  return s;
}

export async function listComments(ctx: Ctx, courseId: string): Promise<CourseComment[]> {
  const s = await requireCourseForComments(ctx, courseId);
  // 一般會員看不到被隱藏的留言與自己封鎖的人；管理員看得到全部。
  const { results } = await ctx.db
    .prepare(
      `SELECT id, course_id, member_sub, member_name, body, status, created_at FROM course_comments c WHERE course_id = ?
       AND (? = 'admin' OR (status = 'visible' AND NOT EXISTS (SELECT 1 FROM comment_blocks b WHERE b.member_sub = ? AND b.blocked_sub = c.member_sub)))
       ORDER BY created_at DESC LIMIT 200`,
    )
    .bind(courseId, s.role, s.sub)
    .all<CommentRow>();
  return results.map((r) => toComment(r, s));
}

// ---------- router ----------


// ---------- 加入我的清單（杜杜龍 2026-11-21；邏輯在 my-lists.ts） ----------
/** 清單網址前綴＝安麗會員編號（取自會員中心）；模擬會員用代號。沒有編號就請會員先到會員中心填寫。 */
export async function listNumber(s: Session): Promise<string> {
  const raw = s.kind === "central" ? await memberNumberOf(s.sub, s.token) : `demo9${s.sub.replace(/[^a-z0-9]/gi, "")}`;
  return libraryNumber(raw) ?? fail(409, "no_member_number", "要先在會員中心填寫安麗會員編號，清單的分享網址才會建立");
}
export const listQuota = async (ctx: Ctx, sub: string) => {
  const app = (await loadConfig(ctx.db)).app;
  return quotaOf(ctx.db, sub, app.listBaseQuota, app.listUnlocks);
};
/** my-lists.ts 的錯誤轉成一般的 API 錯誤。 */
export async function listGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ListError) return fail(e.status, e.code, e.message);
    throw e;
  }
}

export type Handler = (ctx: Ctx, params: string[]) => Promise<unknown>;
