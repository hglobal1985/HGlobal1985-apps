import { HQ_SLUG, RESERVED_SLUGS, SLUG_RE } from "./short-links.ts";
import { romanizeName, urlNameVariants } from "./romanize.ts";
import {
  DEMO_MEMBERS,
  HQ_UNIT,
  REVIEW_REASONS,
  ACHIEVEMENT_TYPES,
  applicantLabel,
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
  type SeriesArt,
  type EditorCandidate,
  type Member,
  type AttachmentType,
  type Announcement,
  type CourseDeleteImpact,
  type Notice,
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
} from "./contract.ts";
import { flushEmails } from "./email.ts";
import { centerMembers, centralAddJobTitle, rankBadges, amwayMe, centerKey, centerList, rankOptionList, centralProfileView, centralSuggest, centralWriteField, contactEmail, forgetMember, legalNameOf, profileGaps, profileSummary, rankOptions, rankValue, reportIntegration, saveContactEmail, validEmail, verifyWebhook, APP_ID, isAdmin, looksLikeJwt, memberContext, rankEligibility, verifyAccessToken } from "./central.ts";
import type { D1Database, D1PreparedStatement, Env } from "./d1.ts";
import { LINK_DEFAULT_TITLE, classifyLink, parseHttpsUrl } from "./links.ts";
import { fetchLinkTitle } from "./link-title.ts";
import { evaluateAchievements } from "./achievements.ts";
import { TranscribeError, transcribeNext, transcriptView } from "./transcribe.ts";
import { AI_JOBS, AI_MODELS, AiStopped, keyStatuses, loadSelection, testConnection, loadSettings, normalizeSelection, normalizeSettings, saveSelection, saveSettings, usageSummary } from "./ai-models.ts";
import { loadConfig, normalizeConfig, saveConfig } from "./ui-config.ts";
import { collectCfStats } from "./cf-stats.ts";
import { collectAppStats } from "./app-stats.ts";
import { collectMuxStats } from "./mux-stats.ts";
import { audioUrl, sniffImage, verifyAudioUrl } from "./media.ts";
import { checkMuxPlayback, listMuxAssets, MuxApiError, muxPlaybackUrl, muxThumbnail } from "./mux.ts";

const SESSION_DAYS = 30;
const DEMO_VIDEO_PATH = "/media/orientation.mp4";

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const fail = (status: number, code: string, message: string): never => {
  throw new HttpError(status, code, message);
};

/** demo：模擬會員（rankCode 為示範獎銜）；central：中央會員（不持有獎銜，資格每次向中央查詢）。 */
type SessionBase = { sub: string; name: string; role: "student" | "admin"; roles: string[]; hglobal: boolean; center: { key: string; label: string } | null };
type Session = SessionBase & ({ kind: "demo"; rankCode: string } | { kind: "central"; token: string; avatarUrl: string | null; rankValue?: string | null; rankLabel?: string });
type Ctx = { env: Env; db: D1Database; req: Request; url: URL; platform: ClientPlatform; session: Session | null; touched?: string; /** 中心縮寫（centerKey → slug），列表／詳情組課程網址用。 */ centerSlugs?: Map<string, string> };

// ---------- helpers ----------

function platformOf(req: Request): ClientPlatform {
  const p = req.headers.get("x-client-platform");
  return p === "ios" || p === "android" ? p : "web";
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
function randomToken(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** 付款代碼：P＋8 碼（去掉易混淆字元），唯一；匯款備註填寫，對帳以代碼為準。 */
function payRef(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `P${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => alphabet[b % alphabet.length]).join("")}`;
}
function orderId(now: Date): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rand = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => alphabet[b % alphabet.length]).join("");
  return `ORD-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${rand}`;
}
const iso = (d = new Date()) => d.toISOString();

async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return fail(400, "bad_json", "請求格式錯誤");
  }
}

function requireMember(ctx: Ctx): Session {
  return ctx.session ?? fail(401, "unauthenticated", "請先登入");
}
/** 最高管理員（超級管理員）；總部秘書沒有這個權限。 */
function requireSuperAdmin(ctx: Ctx): Session {
  const s = requireMember(ctx);
  if (!s.roles.includes("super_admin")) fail(403, "forbidden", "只有超級管理員可以使用");
  return s;
}
function requireAdmin(ctx: Ctx): Session {
  const s = requireMember(ctx);
  if (s.role !== "admin") fail(403, "forbidden", "需要管理員權限");
  return s;
}

const demoEnabled = (env: Env) => env.DEMO_LOGIN === "on";

async function loadSession(env: Env, req: Request, warmAmway = false, light = false): Promise<Session | null> {
  const db = env.DB;
  const auth = req.headers.get("authorization") ?? "";
  const jwt = /^Bearer (\S+)$/.exec(auth)?.[1];
  if (jwt && looksLikeJwt(jwt)) {
    const sub = await verifyAccessToken(jwt);
    if (!sub) return null;
    // 「完善資料」視窗的請求只需要知道是誰（帶著會員本人的 Token 轉給會員中心），不必先問名稱與職務，省下一趟。
    if (light) return { kind: "central", sub, name: "", avatarUrl: null, role: "student", token: jwt, roles: [], hglobal: false, center: null };
    // 向會員中心的查詢同時送出（/me 還會順便預先查好 Amway 資料，後面直接用快取）。
    const [prof, superAdmin, mc] = await Promise.all([profileSummary(sub, jwt), isAdmin(sub, jwt, env.LEARN_ADMIN_SUBS), memberContext(sub, jwt), warmAmway ? amwayMe(sub, jwt) : undefined]);
    // 管理員（可管理課程、審核全部報名）＝超級管理員、總部秘書，或 LEARN_ADMIN_SUBS 指定的會員。
    const admin = superAdmin || mc.roles.includes("super_admin") || mc.roles.includes("secretary");
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

async function ranks(db: D1Database): Promise<Map<string, Rank>> {
  const { results } = await db.prepare("SELECT code, name, sort_order FROM ranks ORDER BY sort_order").all<{
    code: string;
    name: string;
    sort_order: number;
  }>();
  return new Map(results.map((r) => [r.code, { code: r.code, name: r.name, order: r.sort_order }]));
}

const ROLE_TITLES: Record<string, string> = { super_admin: "超級管理員", secretary: "總部秘書", president: "會長", sound: "音控", course: "課務", reviewer: "審核員" };
/** 對外顯示的獎銜：會員中心獎銜為「無」（或沒填）時顯示「安麗寶寶」；其餘用獎銜階梯的名稱。 */
function rankLabelOf(v: string | null, rankMap: Map<string, Rank>): string {
  if (!v || v === "none" || v === "無") return "安麗寶寶";
  return rankMap.get(v)?.name ?? v;
}
function memberOf(s: Session, rankMap: Map<string, Rank>, extra: { duties?: string[] } = {}): Member {
  const titles = [...s.roles.map((r) => ROLE_TITLES[r]).filter(Boolean), ...(extra.duties ?? [])];
  const base = { sub: s.sub, name: s.name, role: s.role, titles: [...new Set(titles)], reviewer: s.role === "admin" || s.roles.includes("president") || !!extra.duties?.length, center: s.center?.label ?? null };
  // 中央會員的獎銜屬 Amway 資料，App 不取得也不顯示；只有模擬會員帶示範獎銜。
  if (s.kind === "central") return { ...base, rank: null, demo: false, avatarUrl: s.avatarUrl, rankLabel: s.rankLabel ?? (s.rankValue === undefined ? null : rankLabelOf(s.rankValue, rankMap)), rankBadge: null };
  return { ...base, rank: rankMap.get(s.rankCode) ?? null, demo: true, rankBadge: null };
}

/** 各最低獎銜是否符合：模擬會員比對示範獎銜；中央會員向中央查詢（fail closed）。 */
async function eligibilityFor(session: Session | null, rankMap: Map<string, Rank>, codes: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (!session) return out;
  if (session.kind === "central") return rankEligibility(session.sub, session.token, codes);
  const mine = rankMap.get(session.rankCode)?.order ?? -1;
  for (const c of codes) out.set(c, c === "none" || mine >= (rankMap.get(c)?.order ?? Infinity));
  return out;
}

function audit(db: D1Database, actor: string, action: string, type: string, id: string, detail = ""): D1PreparedStatement {
  return db
    .prepare("INSERT INTO audit_log (id, actor_sub, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), actor, action, type, id, detail);
}

function notify(db: D1Database, to: { sub: string } | { role: "admin" } | { role: "president"; centerKey: string }, title: string, body: string, link: string): D1PreparedStatement {
  return db
    .prepare("INSERT INTO notifications (id, recipient_sub, recipient_role, recipient_center_key, title, body, link) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), "sub" in to ? to.sub : null, "role" in to ? to.role : null, "centerKey" in to ? to.centerKey : null, title, body, link);
}

/** 統計分析：超級管理員、總部秘書一定可以；其他職務要被超級管理員指定。 */
async function canViewStats(ctx: Ctx, s: Session): Promise<boolean> {
  if (s.role === "admin") return true;
  if (!s.roles.length) return false;
  const cfg = await loadConfig(ctx.db);
  return s.roles.some((r) => cfg.statsRoles.includes(r));
}

/** 重新計算會員的徽章；新取得的發站內通知，回傳完整清單。 */
async function grantAchievements(ctx: Ctx, sub: string) {
  const { list, fresh } = await evaluateAchievements(ctx.db, sub);
  if (fresh.length) await ctx.db.batch(fresh.map((a) => notify(ctx.db, { sub }, "獲得學習徽章", `${a.icon} ${a.name}：${a.description}`, "/achievements")));
  return list;
}

const ACH_TYPES = Object.keys(ACHIEVEMENT_TYPES) as AchievementType[];
async function achievementBody(ctx: Ctx, body: Record<string, unknown>, creating: boolean) {
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
  if (body.type !== undefined || creating) {
    if (typeof body.type !== "string" || !ACH_TYPES.includes(body.type as AchievementType)) fail(400, "invalid_type", "條件類型不正確");
    sets.push(["condition_type", body.type]);
  }
  if (body.threshold !== undefined || creating) {
    const n = Number(body.threshold ?? 1);
    if (!Number.isInteger(n) || n < 1 || n > 100000) fail(400, "invalid_threshold", "達成數量請輸入 1 以上的整數");
    sets.push(["threshold", n]);
  }
  if (body.courseId !== undefined) {
    if (body.courseId === null || body.courseId === "") sets.push(["course_id", null]);
    else {
      if (!(await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").bind(String(body.courseId)).first())) fail(400, "invalid_course", "找不到這門課程");
      sets.push(["course_id", body.courseId]);
    }
  }
  if (body.active !== undefined) sets.push(["active", body.active === true ? 1 : 0]);
  return sets;
}
async function listAchievements(ctx: Ctx): Promise<AdminAchievement[]> {
  const { results } = await ctx.db
    .prepare("SELECT a.id, a.name, a.description, a.icon, a.condition_type, a.threshold, a.course_id, a.active, (SELECT title FROM courses WHERE id = a.course_id) AS course_title, (SELECT COUNT(*) FROM member_achievements m WHERE m.achievement_id = a.id) AS earned_count FROM achievements a ORDER BY a.sort_order, a.created_at")
    .all<{ id: string; name: string; description: string; icon: string; condition_type: AchievementType; threshold: number; course_id: string | null; active: number; course_title: string | null; earned_count: number }>();
  return results.map((r) => ({ id: r.id, name: r.name, description: r.description, icon: r.icon, type: r.condition_type, threshold: r.threshold, courseId: r.course_id, courseTitle: r.course_title, active: r.active === 1, earnedCount: r.earned_count }));
}

/** 刪除一位會員在本 App 的所有資料。 */
export async function purgeMember(db: D1Database, sub: string, actor: string, action: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM course_comments WHERE member_sub = ?").bind(sub),
    db.prepare("DELETE FROM comment_blocks WHERE member_sub = ? OR blocked_sub = ?").bind(sub, sub),
    db.prepare("DELETE FROM comment_reports WHERE reporter_sub = ?").bind(sub),
    db.prepare("DELETE FROM lesson_progress WHERE member_sub = ?").bind(sub),
    db.prepare("DELETE FROM learning_started WHERE member_sub = ?").bind(sub),
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
    db.prepare("DELETE FROM sessions WHERE member_sub = ?").bind(sub),
    audit(db, actor, action, "member", sub),
  ]);
  forgetMember(sub);
}

// ---------- courses ----------

type CourseRow = {
  id: string;
  title: string;
  subtitle: string;
  teacher: string;
  teacher_rank: string;
  teacher_title: string;
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
  url_name: string | null;
  free_from: string | null;
  free_until: string | null;
  review_group_id: string | null;
  allow_president: number;
  event_start: string | null;
  event_end: string | null;
  is_public: number;
  price_tba: number;
  hide_home: number;
  diamond_free: number;
  series: string;
  series_edm_key: string | null;
  series_art_version: number | null;
  early_bird: number;
  early_price_twd: number | null;
  early_until: string | null;
  location: string;
  location_none: number;
  is_online: number;
  chapter_covers: number;
  auto_cover: number;
  center_course: number;
  created_at: string;
  /** 第一支 YouTube 章節的影片代碼（臨時封面用）。 */
  yt_ref: string | null;
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

const COURSE_SELECT = `SELECT c.id, c.title, c.subtitle, c.teacher, c.teacher_rank, c.teacher_title, c.category, c.price_twd, c.min_rank_code, c.theme, c.status, c.description, c.guidance_unit, c.host_unit, c.host_center_key, c.is_shorts, c.is_list, c.url_name, c.free_from, c.free_until, c.review_group_id, c.allow_president, c.event_start, c.event_end, c.is_public, c.price_tba, c.hide_home, c.diamond_free, c.series, (SELECT a.edm_key FROM series_art a WHERE a.series = c.series AND c.series <> '') AS series_edm_key, (SELECT a.art_version FROM series_art a WHERE a.series = c.series AND c.series <> '') AS series_art_version, c.early_bird, c.early_price_twd, c.early_until, c.location, c.location_none, c.is_online, c.chapter_covers, c.auto_cover, c.center_course, (SELECT l.media_ref FROM lessons l WHERE l.course_id = c.id AND l.media_type = 'youtube' AND l.media_ref IS NOT NULL ORDER BY l.position LIMIT 1) AS yt_ref, c.edm_key, c.cover_key, c.edm_view_y, c.cover_rect, c.art_version, c.created_by_sub, c.edited_by_name, c.edited_at, c.updated_at, c.created_at,
  (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id AND (l.kind = 'chapter' OR (l.kind = 'material' AND l.is_full = 0 AND l.media_ref IS NOT NULL AND l.media_type <> 'demo' AND l.course_id IN (SELECT id FROM courses WHERE is_list = 1)))) AS lesson_count,
  (SELECT COALESCE(SUM(duration_minutes), 0) FROM lessons l WHERE l.course_id = c.id AND (l.kind = 'chapter' OR (l.kind = 'material' AND l.is_full = 0 AND l.media_ref IS NOT NULL AND l.media_type <> 'demo' AND l.course_id IN (SELECT id FROM courses WHERE is_list = 1)))) AS total_minutes,
  (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id AND (l.kind = 'chapter' OR (l.kind = 'material' AND l.is_full = 0 AND l.media_ref IS NOT NULL AND l.media_type <> 'demo' AND l.course_id IN (SELECT id FROM courses WHERE is_list = 1))) AND l.duration_minutes = 0) AS zero_minute_lessons,
  (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id AND ((l.media_type <> 'demo' AND l.media_ref IS NOT NULL) OR EXISTS (SELECT 1 FROM lesson_attachments a WHERE a.lesson_id = l.id))) AS material_count
  FROM courses c`;

async function memberCourseState(db: D1Database, sub: string | undefined) {
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
type MemberState = Awaited<ReturnType<typeof memberCourseState>>;

/** 早鳥優惠是否有效：台灣時間 early_until（含當天）之前。 */
const earlyActive = (row: { early_bird: number; early_price_twd: number | null; early_until: string | null; price_twd: number }, now = iso()) =>
  row.early_bird === 1 && row.early_price_twd != null && row.early_price_twd < row.price_twd && !!row.early_until && new Date(Date.parse(now) + 8 * 3600_000).toISOString().slice(0, 10) <= row.early_until;

/** 「鑽石免費」判斷用的獎銜代碼：鑽石（含）以上。 */
const DIAMOND = "diamond";

/** 「會長也可報名」：課程開啟此條件時，會長不受獎銜限制。 */
const byPresident = (s: Session | null, c: { allow_president: number }) => c.allow_president === 1 && !!s?.roles.includes("president");

const inFreeWindow = (row: { free_from: string | null; free_until: string | null }, now = iso()) =>
  !!(row.free_from || row.free_until) && (!row.free_from || row.free_from <= now) && (!row.free_until || now < row.free_until);

/** 課程的 EDM／封面網址（含 YouTube 縮圖的自動與臨時封面）。 */
function courseArt(row: CourseRow) {
  const thumb = row.yt_ref ? ytThumbUrl(row.yt_ref) : null;
  const forced = row.auto_cover === 1 && !!thumb;
  const none = !row.edm_key && !row.cover_key && !!thumb;
  if (forced || none) return { edmUrl: thumb, coverUrl: thumb, edmViewY: 0, coverRect: null };
  return {
    edmUrl: row.edm_key ? pubUrl(row.edm_key, row.art_version) : null,
    coverUrl: row.cover_key ? pubUrl(row.cover_key, row.art_version) : null,
    edmViewY: row.edm_view_y,
    coverRect: parseCoverRect(row.cover_rect),
  };
}
/** YouTube 影片縮圖（16:9、沒有黑邊）。 */
const ytThumbUrl = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

function summarize(row: CourseRow, ctx: Ctx, rankMap: Map<string, Rank>, state: MemberState, eligibility: Map<string, boolean>): CourseSummary {
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
    category: row.category,
    priceTwd: web ? price : null,
    originalPriceTwd: web ? row.price_twd : null,
    free: price === 0 && row.price_tba !== 1,
    paid: row.price_twd > 0, // 付費課程（原價大於 0；限時免費、早鳥、鑽石免費仍算付費課程）
    freeNow,
    freeUntil: freeNow ? row.free_until : null,
    minRank,
    theme: row.theme,
    // 封面：勾了「自動使用 YouTube 畫面」＝一律用第一支 YouTube 影片的縮圖；沒勾但完全沒有 EDM 與封面＝臨時用縮圖。
    ...courseArt(row),
    autoCover: row.auto_cover === 1,
    // 中心課程＝主辦單位含某個中心（自動，不再手動勾選）；只有總部主辦的是一般課程。
    centerCourse: row.host_center_key != null,
    isShorts: row.is_shorts === 1,
    isList: row.is_list === 1,
    shortPath: row.url_name ? (row.host_center_key ? (ctx.centerSlugs?.get(row.host_center_key) ? `${ctx.centerSlugs.get(row.host_center_key)}/${row.url_name}` : null) : `${HQ_SLUG}/${row.url_name}`) : null,
    createdAt: row.created_at,
    hostCenter: hostCenterOf(row.host_unit),
    hostCenterKey: row.host_center_key,
    status: row.status,
    guidanceUnit: row.guidance_unit,
    hostUnit: row.host_unit,
    eventStart: row.event_start,
    eventEnd: row.event_end,
    isPublic: row.is_public === 1,
    pendingOrderId: state.pendingOrder.get(row.id) ?? null,
    priceTba: row.price_tba === 1,
    hideFromHome: row.hide_home === 1,
    series: row.series,
    seriesEdmUrl: row.series_edm_key ? pubUrl(row.series_edm_key, row.series_art_version ?? 1) : null,
    // 學習中：有報名的看報名紀錄的隱藏；沒報名但播放過的（例如管理員、公開課程）看播放紀錄的隱藏。
    hiddenFromLearning: state.enrolled.has(row.id) ? state.hidden.has(row.id) : state.startedHidden.has(row.id),
    lastLearnedAt: state.lastLearned.get(row.id) ?? null,
    started: state.started.has(row.id) || (state.done.get(row.id) ?? 0) > 0,
    watchFree: !!ctx.session && row.status === "published" && row.price_twd === 0 && row.price_tba !== 1 && (eligibility.get(row.min_rank_code) === true || byPresident(ctx.session, row)),
    diamondFree: row.diamond_free === 1,
    diamondFreeNow: diamondNow,
    earlyBird: row.early_bird === 1 && row.early_price_twd != null && !!row.early_until ? { priceTwd: web ? row.early_price_twd : null, until: row.early_until, active: earlyNow } : null,
    location: row.location,
    locationNone: row.location_none === 1,
    isOnline: row.is_online === 1,
    chapterCovers: row.chapter_covers === 1,
    lessonCount: row.lesson_count,
    hasMaterial: row.material_count > 0,
    totalMinutes: row.total_minutes,
    eligible: eligibility.get(row.min_rank_code) === true || byPresident(ctx.session, row),
    allowPresident: row.allow_president === 1,
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

async function listCourses(ctx: Ctx, all: boolean): Promise<CourseSummary[]> {
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
  const [{ results }, rankMap, state] = await Promise.all([
    ctx.db.prepare(`${COURSE_SELECT}${where} ORDER BY c.sort_order, c.created_at`).bind(...args).all<CourseRow>(),
    ranks(ctx.db),
    memberCourseState(ctx.db, s?.sub),
  ]);
  const eligibility = await eligibilityFor(s, rankMap, [...results.map((r) => r.min_rank_code), DIAMOND]);
  ctx.centerSlugs = await centerSlugMap(ctx.db);
  const out = results.map((r) => summarize(r, ctx, rankMap, state, eligibility));
  if (!rights || !s) return out;
  const r = rights;
  return out.flatMap((c, i) => {
    const can = courseCan(r, s, results[i]!);
    // 小編看不到「別人的、自己又不能動」的未上架課程。
    if (c.status !== "published" && !can.edit && !can.remove && !can.restore) return [];
    return [{ ...c, can }];
  });
}

// ---------- 課程管理權限：總部、該中心的會長與音控、小編 ----------

/** 小編的三種權限。 */
type EditorFlags = { create: boolean; editOthers: boolean; deleteOthers: boolean };
type Rights = {
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
const NO_RIGHTS: Rights = { any: false, admin: false, staff: false, centerKeys: new Set(), center: null, editor: null };
const rightsMemo = new WeakMap<Ctx, Promise<Rights>>();

/** 登入者的課程管理權限（同一個請求只查一次）。小編身分要「現在的中心」與被指派的中心相同才有效（換中心自動失效）。 */
function rightsOf(ctx: Ctx): Promise<Rights> {
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

const canCreateCourse = (r: Rights) => r.admin || r.staff || !!r.editor?.create;

/** 對某門課能做什麼：總部全部；同中心的會長、音控全部；小編：自己新增的課程完整權限，別人的看「修改別人／刪除別人」。還原封存只有總部、會長、音控。 */
function courseCan(r: Rights, s: Session, row: { host_center_key: string | null; created_by_sub: string }): CourseCan {
  if (r.admin) return { edit: true, remove: true, restore: true };
  if (!row.host_center_key || !r.centerKeys.has(row.host_center_key)) return { edit: false, remove: false, restore: false };
  if (r.staff) return { edit: true, remove: true, restore: true };
  if (!r.editor) return { edit: false, remove: false, restore: false };
  const own = !!row.created_by_sub && row.created_by_sub === s.sub;
  return { edit: own || r.editor.editOthers, remove: own || r.editor.deleteOthers, restore: false };
}

/** 有效報名數：已開通、免費報名、待審核（不含已退回）。大於 0 的課程不能永久刪除，只能「下架封存」。 */
async function registrationCount(db: D1Database, courseId: string): Promise<number> {
  const r = await db
    .prepare("SELECT (SELECT COUNT(*) FROM enrollments WHERE course_id = ?1) + (SELECT COUNT(DISTINCT o.id) FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.course_id = ?1 AND o.status = 'pending') AS n")
    .bind(courseId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/** 中心縮寫對照：centerKey（主辦中心的正規化名稱）→ 短網址縮寫。 */
async function centerSlugMap(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db.prepare("SELECT slug, value FROM short_links WHERE kind = 'center'").all<{ slug: string; value: string }>();
  return new Map(results.map((r) => [centerKey(r.value), r.slug]));
}

/**
 * 課程專屬網址：learn.hglobal1985.com/中心縮寫/英譯主講人-1。條件：有主講人、主辦中心已設定短網址；一旦產生就固定。
 * 編號＝同一主辦中心＋同一英譯姓名已有的最大編號 + 1（從 1 開始，不補零，需要時自然增加位數）。
 */
/** 續播的起點秒數：登入者這一堂還沒看完、上次停在區間中間才回傳；否則 null（從頭播）。 */
async function resumePoint(ctx: Ctx, lessonId: string, start: number, end: number | null): Promise<number | null> {
  const s = ctx.session;
  if (!s) return null;
  const done = await ctx.db.prepare("SELECT 1 AS ok FROM lesson_progress WHERE member_sub = ? AND lesson_id = ?").bind(s.sub, lessonId).first();
  if (done) return null;
  const w = await ctx.db.prepare("SELECT position_sec FROM lesson_watch WHERE member_sub = ? AND lesson_id = ?").bind(s.sub, lessonId).first<{ position_sec: number | null }>();
  const p = w?.position_sec;
  if (p == null || p < start + 5 || (end != null && p > end - 10)) return null;
  return p;
}

/** 這門課是不是「素材清單」（沒有章節，只有其他教材）。 */
async function isListCourse(ctx: Ctx, courseId: string): Promise<boolean> {
  return (await ctx.db.prepare("SELECT is_list FROM courses WHERE id = ?").bind(courseId).first<{ is_list: number }>())?.is_list === 1;
}

/** 課程「費用與審核」的審核窗口：審核群組（成員）、指定身份、指定的會員。 */
async function reviewDesk(ctx: Ctx, id: string): Promise<ReviewDesk> {
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

type InviteRow = { course_id: string; created_by_sub: string; expires_at: string; used_by_sub: string | null; title: string };
async function inviteOf(ctx: Ctx, token: string): Promise<InviteRow> {
  const r = await ctx.db.prepare("SELECT i.course_id, i.created_by_sub, i.expires_at, i.used_by_sub, c.title FROM review_invites i JOIN courses c ON c.id = i.course_id WHERE i.token_hash = ?").bind(await sha256(token)).first<InviteRow>();
  return r ?? fail(404, "invite_not_found", "找不到這個邀請，請確認網址是否完整");
}
/** open＝可以接受；mine＝自己已經接受過；used＝被別人用掉；expired＝超過 24 小時。 */
function inviteState(inv: InviteRow, sub: string): "open" | "mine" | "used" | "expired" {
  if (inv.used_by_sub) return inv.used_by_sub === sub ? "mine" : "used";
  return inv.expires_at < iso() ? "expired" : "open";
}

async function ensureCourseUrl(ctx: Ctx, courseId: string): Promise<void> {
  try {
    const c = await ctx.db.prepare("SELECT teacher, host_center_key, url_name FROM courses WHERE id = ?").bind(courseId).first<{ teacher: string | null; host_center_key: string | null; url_name: string | null }>();
    if (!c || c.url_name || !c.teacher?.trim()) return;
    // 有主辦中心：要用中心的縮寫（中心還沒設定縮寫就先不產生）；沒有主辦中心（總部）：用保留縮寫 hq。
    if (c.host_center_key && !(await centerSlugMap(ctx.db)).has(c.host_center_key)) return;
    const base = romanizeName(c.teacher);
    if (!base) return;
    const like = `${base.replace(/[%_\\]/g, "")}-%`;
    const used = c.host_center_key
      ? await ctx.db.prepare("SELECT url_name FROM courses WHERE host_center_key = ? AND url_name LIKE ? ESCAPE '\\'").bind(c.host_center_key, like).all<{ url_name: string }>()
      : await ctx.db.prepare("SELECT url_name FROM courses WHERE host_center_key IS NULL AND url_name LIKE ? ESCAPE '\\'").bind(like).all<{ url_name: string }>();
    let max = 0;
    for (const r of used.results) {
      const m = /-(\d+)$/.exec(r.url_name);
      if (m && r.url_name.slice(0, -m[0].length) === base) max = Math.max(max, Number(m[1]));
    }
    await ctx.db.prepare("UPDATE courses SET url_name = ? WHERE id = ? AND url_name IS NULL").bind(`${base}-${max + 1}`, courseId).run();
  } catch {
    /* 不影響儲存 */
  }
}

/** 補齊全站（或某個主辦中心）還沒有專屬網址的課程，依建立時間編號。 */
async function backfillCourseUrls(ctx: Ctx, centerKeyOnly?: string): Promise<number> {
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
    .prepare(`SELECT id FROM courses WHERE url_name IS NULL AND teacher <> ''${centerKeyOnly ? " AND host_center_key = ?" : ""} ORDER BY created_at, id`)
    .bind(...(centerKeyOnly ? [centerKeyOnly] : []))
    .all<{ id: string }>();
  for (const r of results) await ensureCourseUrl(ctx, r.id);
  const left = await ctx.db.prepare("SELECT COUNT(*) AS n FROM courses WHERE url_name IS NOT NULL").first<{ n: number }>();
  return left?.n ?? 0;
}

/** 主辦中心：主辦單位裡第一個不是總部的名稱。 */
const hostCenterOf = (hostUnit: string) => splitCats(hostUnit).find((x) => x !== HQ_UNIT) ?? "";


async function courseDetail(ctx: Ctx, id: string): Promise<CourseDetail> {
  const s = ctx.session;
  const row = await ctx.db.prepare(`${COURSE_SELECT} WHERE c.id = ?`).bind(id).first<CourseRow>();
  // 未登入的訪客：只有「完全公開」且已上架的課程可以看；其他一律要求登入。
  if (!s && (!row || row.status !== "published" || row.is_public !== 1)) return fail(401, "unauthenticated", "請先登入");
  if (!row) return fail(404, "not_found", "找不到這門課程");
  const can = s ? courseCan(await rightsOf(ctx), s, row) : { edit: false, remove: false, restore: false };
  const manages = can.edit || can.remove || can.restore;
  const [rankMap, state, lessons, done] = await Promise.all([
    ranks(ctx.db),
    memberCourseState(ctx.db, s?.sub),
    ctx.db
      .prepare("SELECT id, position, title, sharer, sharer_rank, sharer_title, duration_minutes, media_type, media_ref, start_seconds, end_seconds, event_date, cover_key, poster_key, art_version, auto_cover, kind, is_full, is_speaker, is_summary FROM lessons WHERE course_id = ? ORDER BY position")
      .bind(id)
      .all<{ id: string; position: number; title: string; sharer: string; sharer_rank: string; sharer_title: string; duration_minutes: number; media_type: MediaType; media_ref: string | null; start_seconds: number | null; end_seconds: number | null; event_date: string | null; cover_key: string | null; poster_key: string | null; art_version: number; auto_cover: number; kind: string; is_full: number; is_speaker: number; is_summary: number }>(),
    s ? ctx.db.prepare("SELECT lesson_id FROM lesson_progress WHERE member_sub = ? AND course_id = ?").bind(s.sub, id).all<{ lesson_id: string }>() : Promise.resolve({ results: [] as { lesson_id: string }[] }),
  ]);
  // 未上架：只有能管理的人看得到。下架封存：管理者，以及有報名、審核中或學習過的學員（照常上課）。
  const archivedForMe = row.status === "archived" && (state.enrolled.has(id) || state.pending.has(id) || state.started.has(id));
  if (row.status !== "published" && !manages && !archivedForMe) return fail(404, "not_found", "找不到這門課程");
  const completed = new Set(done.results.map((r) => r.lesson_id));
  // 其他教材的外部連結（每個教材一條）：類型給所有人（畫面顯示官方 Logo），網址只給有權限看的人。
  const linkRows = await ctx.db.prepare("SELECT lesson_id, att_type, link_url FROM lesson_attachments WHERE course_id = ? AND kind = 'link' ORDER BY created_at").bind(id).all<{ lesson_id: string; att_type: AttachmentType; link_url: string }>();
  const linkOf = new Map<string, { type: AttachmentType; url: string }>();
  for (const r of linkRows.results) if (!linkOf.has(r.lesson_id)) linkOf.set(r.lesson_id, { type: r.att_type, url: r.link_url });
  const groupPos = new Map<string, number>();
  {
    const n = { chapter: 0, material: 0 };
    for (const l of lessons.results) groupPos.set(l.id, ++n[l.kind === "material" ? "material" : "chapter"]);
  }
  ctx.centerSlugs = await centerSlugMap(ctx.db);
  const summaryNow = summarize(row, ctx, rankMap, state, await eligibilityFor(s, rankMap, [row.min_rank_code, DIAMOND]));
  const watchFree = summaryNow.watchFree;
  const admin = manages;
  const lockedAll = !admin && !(state.enrolled.has(id) || row.is_public === 1 || watchFree);
  return {
    ...summaryNow,
    ...(manages ? { can } : {}),
    description: row.description ?? "",
    lessons: [...lessons.results.map((l) => ({
      id: l.id,
      // 顯示用序號：章節與教材各自從 1 開始編號（資料庫裡的 position 是整門課共用、不重複的排序）。
      position: groupPos.get(l.id)!,
      material: l.kind === "material",
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
      ...(l.kind === "chapter" ? { isSpeaker: l.is_speaker === 1, isSummary: l.is_summary === 1 } : {}),
      sharer: l.sharer,
      sharerRank: l.sharer_rank,
      sharerRankName: rankMap.get(l.sharer_rank)?.name ?? "",
      sharerTitle: l.sharer_title,
      // 章節封面：勾了「自動使用 YouTube 畫面」＝影片縮圖；沒勾但沒上傳封面＝臨時用縮圖（非 YouTube 章節維持 null＝用課程封面）。
      // 素材清單裡的影片一律用 YouTube 縮圖（業主 2026-11-17）；一般課程：有上傳章節封面用上傳的，沒有才用 YouTube 縮圖。
      coverUrl: l.media_type === "youtube" && l.media_ref && (row.is_list === 1 || !l.cover_key) ? ytThumbUrl(l.media_ref) : l.cover_key ? pubUrl(l.cover_key, l.art_version) : null,
      posterUrl: l.media_type === "youtube" && l.media_ref && (row.is_list === 1 || !l.poster_key) ? ytThumbUrl(l.media_ref) : l.poster_key ? pubUrl(l.poster_key, l.art_version) : null,
      autoCover: l.auto_cover === 1,
      // 還沒上傳／設定內容的章節（新增課程時自動建立的空白示範章節）＝敬請期待。
      ready: (l.media_type !== "demo" && !!l.media_ref) || l.duration_minutes > 0 || (l.kind === "material" && linkOf.has(l.id)),
      // 完全公開的課程：任何人（含訪客與會員）都可以看章節，不需要報名。
      locked: lockedAll,
      ...(l.kind === "material" && linkOf.get(l.id) ? { linkType: linkOf.get(l.id)!.type, ...(lockedAll ? {} : { linkUrl: linkOf.get(l.id)!.url }) } : {}),
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
            registrations: await registrationCount(ctx.db, id),
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
async function canWatch(ctx: Ctx, courseId: string): Promise<boolean> {
  const s = ctx.session;
  if (!s) {
    // 訪客：只有完全公開、已上架的課程可以看。
    const pub = await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE id = ? AND is_public = 1 AND status = 'published'").bind(courseId).first();
    return !!pub;
  }
  if (s.role === "admin") return true;
  if ((await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE id = ? AND is_public = 1 AND status = 'published'").bind(courseId).first())) return true; // 完全公開的課程，會員也不必報名
  const rights = await rightsOf(ctx);
  if (rights.any) {
    const c = await ctx.db.prepare("SELECT host_center_key, created_by_sub FROM courses WHERE id = ?").bind(courseId).first<{ host_center_key: string | null; created_by_sub: string }>();
    if (c) {
      const can = courseCan(rights, s, c);
      if (can.edit || can.remove || can.restore) return true;
    }
  }
  const row = await ctx.db.prepare("SELECT 1 AS ok FROM enrollments WHERE member_sub = ? AND course_id = ? LIMIT 1").bind(s.sub, courseId).first();
  if (row) return true;
  return freeWatchable(ctx, courseId); // 設定免費的課程：符合資格就能直接看，不用報名
}

/** 設定免費（費用 0、不是「尚未公布」）、已上架、而且這位會員符合資格：不需報名就能收看。 */
async function freeWatchable(ctx: Ctx, courseId: string): Promise<boolean> {
  const s = ctx.session;
  if (!s) return false;
  const c = await ctx.db
    .prepare("SELECT min_rank_code, allow_president, price_twd, price_tba FROM courses WHERE id = ? AND status = 'published'")
    .bind(courseId)
    .first<{ min_rank_code: string; allow_president: number; price_twd: number; price_tba: number }>();
  if (!c || c.price_twd !== 0 || c.price_tba === 1) return false;
  if (byPresident(s, c)) return true;
  const eligibility = await eligibilityFor(s, await ranks(ctx.db), [c.min_rank_code]);
  return eligibility.get(c.min_rank_code) === true;
}

/** 第一次開始看設定免費的課程時，自動幫他完成免費報名（這樣「學習中」、進度、學習成就都會正常記錄）。已經報名過的不會重複。 */
async function ensureFreeEnrollment(ctx: Ctx, courseId: string): Promise<void> {
  const s = ctx.session;
  if (!s || s.role === "admin") return;
  const has = await ctx.db.prepare("SELECT 1 AS ok FROM enrollments WHERE member_sub = ? AND course_id = ? LIMIT 1").bind(s.sub, courseId).first();
  if (has) return;
  const pubRow = await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE id = ? AND is_public = 1 AND status = 'published'").bind(courseId).first();
  if (!pubRow && !(await freeWatchable(ctx, courseId))) return;
  await createOrders(ctx, { courseIds: [courseId] }, true).catch(() => undefined);
}

/** 學員打開免費課程的介紹頁：自動加入「學習中」（沒報名過就自動完成免費報名），之前被隱藏的也恢復顯示。 */
async function openFreeCourse(ctx: Ctx, courseId: string): Promise<void> {
  const s = ctx.session;
  if (!s || s.role === "admin") return;
  const c = await ctx.db.prepare("SELECT price_twd, price_tba FROM courses WHERE id = ? AND status = 'published'").bind(courseId).first<{ price_twd: number; price_tba: number }>();
  if (!c || c.price_twd !== 0 || c.price_tba === 1) return;
  await ensureFreeEnrollment(ctx, courseId);
  await ctx.db.prepare("UPDATE enrollments SET hidden = 0 WHERE member_sub = ? AND course_id = ? AND hidden = 1").bind(s.sub, courseId).run();
  await ctx.db.prepare("UPDATE learning_started SET hidden = 0 WHERE member_sub = ? AND course_id = ? AND hidden = 1").bind(s.sub, courseId).run();
}

/** 刪除課程前的影響：多少筆報名紀錄、多少人已開通、已確認收款多少（供「輸入 YES」確認畫面顯示）。 */
async function courseDeleteImpact(db: D1Database, id: string): Promise<CourseDeleteImpact> {
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
/** 頁面瀏覽次數 +1 並回傳累計（中心頁、系列頁共用；業主 2026-11-16：每進入一次就算一次，不分是否同一人）。 */
async function bumpView(db: D1Database, kind: "center" | "series", key: string): Promise<number> {
  const row = await db.prepare("INSERT INTO page_views (kind, key, total) VALUES (?, ?, 1) ON CONFLICT(kind, key) DO UPDATE SET total = total + 1 RETURNING total").bind(kind, key).first<{ total: number }>();
  return row?.total ?? 0;
}
const pubUrl = (key: string, v: number) => `/api/v2/media/pub?k=${encodeURIComponent(key)}&v=${v}`;
const cleanAnnouncement = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 120) : "");
const ART_TYPES = new Set(["president", "sound"]);

/** 編輯某門課的 EDM／封面：要有這門課的「修改」權限。 */
async function requireCourseArt(ctx: Ctx, _s: Session, courseId: string): Promise<void> {
  await requireCourseManager(ctx, courseId);
}

/** 取得課程的管理權限；need＝要的權限（預設「修改」）。 */
async function courseRightsFor(ctx: Ctx, courseId: string): Promise<{ s: Session; can: CourseCan; rights: Rights }> {
  const s = requireMember(ctx);
  const rights = await rightsOf(ctx);
  if (!rights.any) fail(403, "forbidden", "需要課程管理權限");
  const c = await ctx.db.prepare("SELECT host_center_key, created_by_sub FROM courses WHERE id = ?").bind(courseId).first<{ host_center_key: string | null; created_by_sub: string }>();
  if (!c) return fail(404, "not_found", "找不到這門課程");
  return { s, can: courseCan(rights, s, c), rights };
}

/** 課程「修改」權限：總部不限；同中心的會長、音控；小編自己新增的課程，或有「修改別人」權限。 */
async function requireCourseManager(ctx: Ctx, courseId: string): Promise<Session> {
  const { s, can } = await courseRightsFor(ctx, courseId);
  if (!can.edit) fail(403, "forbidden", "沒有修改這門課程的權限（只能管理主辦單位是自己中心、而且有權限的課程）");
  if (ctx.req.method !== "GET") ctx.touched = courseId; // 成功後記下最後修改者
  return s;
}
async function managerVia(ctx: Ctx, sql: string, id: string, what: string): Promise<Session> {
  const row = await ctx.db.prepare(sql).bind(id).first<{ course_id: string }>();
  if (!row) return fail(404, "not_found", `找不到這個${what}`);
  return requireCourseManager(ctx, row.course_id);
}
const requireLessonManager = (ctx: Ctx, id: string) => managerVia(ctx, "SELECT course_id FROM lessons WHERE id = ?", id, "章節");
/** 可以新增課程的人：總部、有中心的會長與音控、有「新增」權限的小編。 */
async function requireCourseCreator(ctx: Ctx): Promise<Session> {
  const s = requireMember(ctx);
  if (!canCreateCourse(await rightsOf(ctx))) fail(403, "forbidden", "沒有新增課程的權限");
  return s;
}
/** 有任何課程管理權限（看管理清單、選項）。 */
async function requireCourseStaff(ctx: Ctx): Promise<Session> {
  const s = requireMember(ctx);
  if (!(await rightsOf(ctx)).any) fail(403, "forbidden", "需要課程管理權限");
  return s;
}

/** 記下最後修改者（章節、圖片等修改也算），顯示在編輯模式的進階設定最下方。 */
const touchCourse = (db: D1Database, courseId: string, s: Session) => db.prepare("UPDATE courses SET edited_by_name = ?, edited_at = ? WHERE id = ?").bind(s.name.slice(0, 60), iso(), courseId);

/** 勾了「總結與銷售課程」的章節，名稱固定為這兩個字。 */
const SUMMARY_TITLE = "總結";
const cleanTitle = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80) : "");

/** 刪除章節／課程時一併清掉附件檔（資料列由 ON DELETE CASCADE 處理，須在刪資料前先取出鍵）。 */
async function attachmentKeys(db: D1Database, where: "lesson_id" | "course_id", id: string): Promise<string[]> {
  const { results } = await db.prepare(`SELECT r2_key FROM lesson_attachments WHERE r2_key IS NOT NULL AND ${where} = ?`).bind(id).all<{ r2_key: string }>();
  return results.map((r) => r.r2_key);
}

async function lessonOf(ctx: Ctx, courseId: string, lessonId: string) {
  const lesson = await ctx.db
    .prepare("SELECT l.id, l.media_type, l.media_ref, l.start_seconds, l.end_seconds FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ? AND l.course_id = ?")
    .bind(lessonId, courseId)
    .first<{ id: string; media_type: MediaType; media_ref: string | null; start_seconds: number | null; end_seconds: number | null }>();
  if (!lesson) return fail(404, "not_found", "找不到這個章節");
  return lesson;
}

// ---------- 報名與審核 ----------

type OrderRow = {
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
  revoked_at: string | null;
};
const ORDER_SELECT = "SELECT o.id, o.member_sub, o.status, o.total_twd, o.reject_reason, o.created_at, o.reviewed_at, o.member_name_snapshot, o.legal_name, o.pay_ref, o.center_key, o.center_label, o.hglobal, o.deferred, o.paid_twd, o.pay_method, o.revoked_at FROM orders o";

async function hydrateOrders(db: D1Database, rows: OrderRow[]): Promise<Order[]> {
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
type ReviewScope = { all: boolean; center: string | null; groups: { groupId: string; centerKey: string }[]; courses: { courseId: string; centerKey: string }[] };
async function reviewScope(ctx: Ctx, s: Session): Promise<ReviewScope> {
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
const hasScope = (sc: ReviewScope) => sc.all || !!sc.center || sc.groups.length > 0 || sc.courses.length > 0;

/** 審核範圍的 SQL 條件（套用在 orders o）。 */
function scopeSql(sc: ReviewScope): { sql: string; args: unknown[] } {
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

async function canReviewOrder(ctx: Ctx, s: Session, orderId: string): Promise<boolean> {
  const sc = await reviewScope(ctx, s);
  if (!hasScope(sc)) return false;
  const w = scopeSql(sc);
  return !!(await ctx.db.prepare(`SELECT 1 AS ok FROM orders o WHERE o.id = ? AND ${w.sql}`).bind(orderId, ...w.args).first());
}

function titleOf(s: Session, duty?: string): string {
  const labels: Record<string, string> = { super_admin: "超級管理員", secretary: "總部秘書", president: "會長", register: "報名窗口", collect: "收費窗口", review: "審核員" };
  const role = ["super_admin", "secretary", "president"].find((r) => s.roles.includes(r));
  return labels[role ?? duty ?? ""] ?? (s.role === "admin" ? "管理員" : "");
}

function event(db: D1Database, orderId: string, actor: { sub: string; name: string; title: string }, action: string, x: { reason?: string | null; message?: string; note?: string } = {}): D1PreparedStatement {
  return db
    .prepare("INSERT INTO order_events (id, order_id, actor_sub, actor_name, actor_title, action, reason_code, message, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), orderId, actor.sub, actor.name, actor.title, action, x.reason ?? null, x.message ?? "", x.note ?? "", iso());
}

/** 付費報名要通知誰：同中心的群組成員＋該中心會長；非寰宇、沒有中心或該中心沒有窗口時改通知總部（秘書、超級管理員）。 */
async function reviewerNotices(ctx: Ctx, o: { id: string; centerKey: string | null; hglobal: boolean; groupId: string | null; courseId?: string | null }, title: string, body: string): Promise<D1PreparedStatement[]> {
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

const METHOD_LABEL: Record<PaymentMethodKey, string> = { cash: "現金", linepay: "LINE Pay", transfer: "網銀轉帳", friend: "託朋友代付" };

/** 學員回報繳費方式（現金／LINE Pay／網銀轉帳／託朋友代付），可送出多次；通知審核人員核對。 */
async function reportPayment(ctx: Ctx, orderId: string, body: Record<string, unknown>): Promise<Order> {
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

type RegItem = { courseId: string };
/** 會員自己取消報名：審核中的報名、或免費自動開通的報名都可以反悔取消；已繳費（含 VIP 免繳費）開通的要聯絡窗口。 */
async function cancelOrder(ctx: Ctx, orderId: string): Promise<{ ok: true }> {
  const s = requireMember(ctx);
  const o = await ctx.db.prepare("SELECT id, member_sub, status, pay_method FROM orders WHERE id = ?").bind(orderId).first<{ id: string; member_sub: string; status: string; pay_method: string | null }>();
  if (!o || o.member_sub !== s.sub) return fail(404, "not_found", "找不到這筆報名");
  const free = o.status === "opened" && o.pay_method === "free";
  if (o.status !== "pending" && !free) fail(409, "not_cancellable", o.status === "opened" ? "已繳費開通的報名無法自行取消，請聯絡報名窗口" : "這筆報名已退回，不需要取消");
  await ctx.db.batch([
    ctx.db.prepare("DELETE FROM notifications WHERE (link = ?1 OR link = ?2)").bind(`/orders/${orderId}`, `/admin/orders/${orderId}`),
    ctx.db.prepare("DELETE FROM enrollments WHERE source_order_id = ?").bind(orderId),
    ctx.db.prepare("DELETE FROM orders WHERE id = ?").bind(orderId),
    audit(ctx.db, s.sub, free ? "order.cancel_free" : "order.cancel", "order", orderId),
  ]);
  return { ok: true };
}

async function createOrders(ctx: Ctx, body: { courseIds?: unknown; items?: unknown }, quiet = false): Promise<Order[]> {
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
      .prepare(`SELECT id, title, price_twd, price_tba, diamond_free, early_bird, early_price_twd, early_until, min_rank_code, free_from, free_until, review_group_id, allow_president FROM courses WHERE status = 'published' AND id IN (${marks})`)
      .bind(...ids)
      .all<{ id: string; title: string; price_twd: number; price_tba: number; diamond_free: number; early_bird: number; early_price_twd: number | null; early_until: string | null; min_rank_code: string; free_from: string | null; free_until: string | null; review_group_id: string | null; allow_president: number }>(),
    ranks(ctx.db),
    memberCourseState(ctx.db, s.sub),
  ]);
  if (courses.length !== ids.length) fail(409, "unavailable", "課程已下架或不存在，請重新確認");
  if (courses.some((c) => c.price_tba === 1)) fail(409, "price_tba", "這門課程的費用尚未公布，暫不開放報名");
  const eligibility = await eligibilityFor(s, rankMap, [...courses.map((c) => c.min_rank_code), DIAMOND]);
  if (courses.some((c) => eligibility.get(c.min_rank_code) !== true && !byPresident(s, c))) fail(403, "rank_required", "此課程需要符合資格才能報名");

  const now = new Date();
  const statements: D1PreparedStatement[] = [];
  const created: string[] = [];
  const actor = { sub: s.sub, name: s.name, title: "學員" };
  for (const item of items) {
    const c = courses.find((x) => x.id === item.courseId)!;
    const key = c.id;
    if (state.enrolled.has(key) || state.pending.has(key)) fail(409, "duplicate", "這門課程已報名（已開通或審核中），請勿重複報名");
    const price = inFreeWindow(c, iso(now)) || (c.diamond_free === 1 && eligibility.get(DIAMOND) === true) ? 0 : earlyActive(c, iso(now)) ? (c.early_price_twd as number) : c.price_twd;
    const isFree = price === 0;
    if (!isFree && ctx.platform !== "web") fail(403, "web_only", "付費課程請至網頁版報名");
    // 付費課程：對帳需要真實姓名，報名當下讀取會員中心的 legal_name 存成快照（免費課程不存）。
    if (!isFree && legal === null) legal = s.kind === "central" ? await legalNameOf(s.token) : s.name;
    const id = orderId(now);
    const title = c.title;
    created.push(id);
    statements.push(
      ctx.db
        .prepare(
          "INSERT INTO orders (id, member_sub, member_name_snapshot, status, total_twd, created_at, center_key, center_label, hglobal, paid_twd, pay_method, paid_at, legal_name, pay_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id, s.sub, s.name, isFree ? "opened" : "pending", price, iso(now), s.center?.key ?? null, s.center?.label ?? "", s.hglobal ? 1 : 0, isFree ? 0 : null, isFree ? "free" : null, isFree ? iso(now) : null, isFree ? "" : (legal ?? ""), isFree ? "" : payRef()),
      ctx.db.prepare("INSERT INTO order_items (order_id, course_id, title_snapshot, price_twd) VALUES (?, ?, ?, ?)").bind(id, c.id, title, price),
      event(ctx.db, id, actor, "submit"),
      audit(ctx.db, s.sub, isFree ? "order.register_free" : "order.register", "order", id, title),
    );
    if (isFree) {
      // 免費課程立即開通；PRIMARY KEY 保證同一會員同一場只會開通一次（重複請求整批失敗）。
      statements.push(
        ctx.db.prepare("INSERT INTO enrollments (member_sub, course_id, source_order_id) VALUES (?, ?, ?)").bind(s.sub, c.id, id),
        ...(quiet ? [] : [notify(ctx.db, { sub: s.sub }, "課程已開通", title, "/learning")]), // 自動報名（直接看免費課程）不發通知
      );
    } else {
      statements.push(
        notify(ctx.db, { sub: s.sub }, "報名已送出，等待審核", title, `/orders/${id}`),
        ...(await reviewerNotices(ctx, { id, centerKey: s.center?.key ?? null, hglobal: s.hglobal, groupId: c.review_group_id, courseId: c.id }, "有新的報名待審核", `${applicantLabel(legal, s.name)}｜${title}｜NT$${price.toLocaleString("en-US")}`)),
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
async function orderDetail(ctx: Ctx, id: string): Promise<Order> {
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
async function syncContact(ctx: Ctx, s: Session): Promise<void> {
  const president = s.roles.includes("president") && s.center ? s.center.key : null;
  await ctx.db
    .prepare("INSERT INTO member_contacts (member_sub, is_admin, president_center_key) VALUES (?, ?, ?) ON CONFLICT(member_sub) DO UPDATE SET is_admin = excluded.is_admin, president_center_key = excluded.president_center_key")
    .bind(s.sub, s.role === "admin" ? 1 : 0, president)
    .run();
  // 超級管理員登入時順便向中央回報採用的串接版本（背景、每小時一次、失敗不影響）。
  if (s.kind === "central" && s.role === "admin") void reportIntegration(s.token).catch(() => undefined);
}

async function contactSettings(ctx: Ctx, s: Session): Promise<NotificationSettings> {
  const row = await ctx.db.prepare("SELECT email, notify_email FROM member_contacts WHERE member_sub = ?").bind(s.sub).first<{ email: string | null; notify_email: number }>();
  // 中央會員：信箱只即時向中央查，不看本地；模擬會員（測試用）才用本地欄位。
  const email = s.kind === "central" ? ((await contactEmail(s.sub, s.token)) ?? null) : (row?.email ?? null);
  return { email, notifyEmail: (row?.notify_email ?? 1) === 1, emailReady: !!ctx.env.EMAIL && !!ctx.env.EMAIL_FROM, source: s.kind === "central" ? "central" : "local" };
}

async function dutyOf(ctx: Ctx, s: Session): Promise<string | undefined> {
  const r = await ctx.db.prepare("SELECT duty FROM review_group_members WHERE member_sub = ? LIMIT 1").bind(s.sub).first<{ duty: string }>();
  return r?.duty;
}

/** 審核：已繳費／VIP 免繳費／退回／延後再審／撤銷開通（撤銷限秘書與超級管理員）。 */
async function reviewOrder(ctx: Ctx, id: string, body: Record<string, unknown>): Promise<Order> {
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
      notify(ctx.db, { sub: order.member_sub }, action === "vip" ? "報名審核通過（VIP 免繳費），課程已開通" : "繳費確認完成，課程已開通", `審核人員：${by}${message ? `\n留言：${message}` : ""}`, `/orders/${id}`),
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
async function addOrderEvent(ctx: Ctx, id: string, body: Record<string, unknown>): Promise<Order> {
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

async function reviewList(ctx: Ctx): Promise<{ rows: OrderRow[]; scope: ReviewScope }> {
  const s = requireMember(ctx);
  const scope = await reviewScope(ctx, s);
  if (!hasScope(scope)) fail(403, "forbidden", "需要審核權限");
  const w = scopeSql(scope);
  const q = ctx.url.searchParams;
  const conds = [w.sql, "o.total_twd > 0"];
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

const csvCell = (v: unknown) => {
  let t = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; // 避免試算表把內容當成公式
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** 對帳報表（CSV，Excel 可直接開啟）：範圍與審核清單相同。 */
async function reviewCsv(ctx: Ctx): Promise<Response> {
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
 * 報名與營收報表（業主 2026-11-17）：指定期間（台灣日期，含頭尾）的報名，依中心／課程／月份加總；看得到的範圍與報名審核相同（總部全部、會長自己中心…）。
 * 免費報名也算在報名數裡；「繳費金額」＝已開通（未撤銷）的付費報名，有實收金額用實收，沒有用應繳。
 */
async function registrationReport(ctx: Ctx): Promise<RegistrationReport> {
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

async function registrationReportCsv(ctx: Ctx): Promise<Response> {
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

type MediaType = "demo" | "youtube" | "mux" | "audio";

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
async function editorCenter(ctx: Ctx, rights: Rights, label: string | null | undefined): Promise<{ key: string; label: string }> {
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

function editorFlags(body: Record<string, unknown>, cur: EditorFlags): EditorFlags {
  const b = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return { create: b(body.canCreate, cur.create), editOthers: b(body.canEditOthers, cur.editOthers), deleteOthers: b(body.canDeleteOthers, cur.deleteOthers) };
}
const editorFlagText = (f: EditorFlags) => [f.create && "新增課程", f.editOthers && "修改別人的課程", f.deleteOthers && "刪除別人的課程"].filter(Boolean).join("、") || "只能看";

async function listEditors(ctx: Ctx, only?: { key: string; label: string }): Promise<CourseEditor[]> {
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
async function requireCenterArt(ctx: Ctx, label: string | null): Promise<{ s: Session; center: { key: string; label: string } }> {
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

const THEMES = ["sage", "rose", "gold", "blue", "clay", "violet"];
function randomId(n: number): string {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => a[b % a.length]).join("");
}
/** 活動日期：YYYY-MM-DD 或 null（清除）。 */
const dayOrNull = (v: unknown): string | null =>
  v === null || v === "" ? null : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : fail(400, "invalid_date", "活動日期格式請用 2026-12-01");
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

/** 封面裁切框（占 EDM 圖片寬高的比例）：x、y 是左上角，w 是寬；高由 16:9 算出。 */
export type CoverRect = { x: number; y: number; w: number };
function parseCoverRect(raw: string | null): CoverRect | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<CoverRect>;
    return [r.x, r.y, r.w].every((n) => typeof n === "number" && Number.isFinite(n)) ? (r as CoverRect) : null;
  } catch {
    return null;
  }
}
async function courseFields(ctx: Ctx, body: Record<string, unknown>, creating: boolean, who: Session) {
  const centerOnly = who.role !== "admin"; // 會長、音控：主辦單位固定是自己的中心，不能自稱總部指導，審核群組只能用自己中心的
  const sets: [string, unknown][] = [];
  // 素材清單（只在建立時決定）：完全公開、免費，沒有主講人與章節。
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
  if (body.isPublic !== undefined) sets.push(["is_public", body.isPublic === true ? 1 : 0]);
  if (body.priceTba !== undefined) sets.push(["price_tba", body.priceTba === true ? 1 : 0]);
  const loc = text(body.location, 100);
  if (loc !== undefined) sets.push(["location", loc]);
  if (body.locationNone !== undefined) sets.push(["location_none", body.locationNone === true ? 1 : 0]);
  if (body.isOnline !== undefined) sets.push(["is_online", body.isOnline === true ? 1 : 0]);
  if (body.chapterCovers !== undefined) sets.push(["chapter_covers", body.chapterCovers === true ? 1 : 0]);
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
  const series = text(body.series, 60);
  if (series !== undefined) {
    // 設定「系列」只限超級管理員（業主 2026-11-16）。
    if (!who.roles.includes("super_admin")) fail(403, "series_super_admin_only", "只有超級管理員可以設定系列");
    sets.push(["series", series]);
  }
  if (body.diamondFree !== undefined) sets.push(["diamond_free", body.diamondFree === true ? 1 : 0]);
  if (body.hideFromHome !== undefined) sets.push(["hide_home", body.hideFromHome === true ? 1 : 0]);
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
  else if (centerOnly && creating && who.center) sets.push(["guidance_unit", who.center.label]);
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
    if (start && end && (end < start || Date.parse(end) - Date.parse(start) > 2 * 86400000)) fail(400, "invalid_date", "活動結束日要在開始日之後，且最多連續 3 天");
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
async function checkGuidanceGroup(ctx: Ctx, guidance: unknown, groupId: unknown) {
  if (guidance !== HQ_UNIT || !groupId) return;
  const g = await ctx.db.prepare("SELECT owner_center_key FROM review_groups WHERE id = ?").bind(String(groupId)).first<{ owner_center_key: string | null }>();
  if (g?.owner_center_key) fail(400, "hq_group_required", `指導單位為「${HQ_UNIT}」的課程只能使用總部的審核群組`);
}

/** 完全公開（訪客免登入可看）只限免費課程，避免付費內容被公開。 */
function checkPublicFree(price: number, isPublic: boolean, tba = false) {
  if (isPublic && tba) fail(400, "public_must_be_free", "費用尚未公布的課程不能設為「完全公開」");
  if (isPublic && price > 0) fail(400, "public_must_be_free", "「完全公開」只能用在免費課程；請先把費用改成 0");
}

async function createCourse(ctx: Ctx, admin: Session) {
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const sets = await courseFields(ctx, body, true, admin);
  checkPublicFree(Number(sets.find(([c]) => c === "price_twd")?.[1] ?? 0), sets.find(([c]) => c === "is_public")?.[1] === 1, sets.find(([c]) => c === "price_tba")?.[1] === 1);
  await checkGuidanceGroup(ctx, body.guidanceUnit, body.reviewGroupId);
  const id = `c${randomId(7)}`;
  const max = await ctx.db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM courses").first<{ m: number }>();
  // 新課程一律先是草稿（小編也一樣，自己再決定上架）；記下建立者。
  const status = sets.find(([c]) => c === "status")?.[1] === "published" ? "published" : "draft";
  const rest = sets.filter(([c]) => c !== "status");
  const cols = ["id", "sort_order", "status", "created_by_sub", "edited_by_name", "edited_at", ...rest.map(([c]) => c)];
  const vals = [id, (max?.m ?? 0) + 1, status, admin.sub, admin.name.slice(0, 60), iso(), ...rest.map(([, v]) => v)];
  // 新增課程不預設建立第一堂章節（業主 2026-11-16），章節一律在課程頁按「新增章節」。
  await ctx.db.batch([
    ctx.db.prepare(`INSERT INTO courses (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...vals),
    audit(ctx.db, admin.sub, "course.create", "course", id, String(body.title ?? "")),
  ]);
  await ensureCourseUrl(ctx, id);
  return courseDetail(ctx, id);
}

/** 中心名稱必須是會員中心清單裡的（行動大學不可自行新增）；示範登入不檢查。 */
/** 獎銜只能是會員中心選單裡的代碼（空字串＝不填）。中央查不到清單時不擋（以免中央暫時故障無法存檔）；測試帳號不檢查。 */
async function assertCentralRank(ctx: Ctx, code: string): Promise<void> {
  const s = ctx.session;
  if (!code || !s || s.kind !== "central") return;
  const list = await rankOptionList(s.token);
  if (list.length && !list.some((o) => o.value === code)) fail(400, "invalid_rank", "獎銜不在會員中心的選單內");
}

/**
 * 新職稱同步到中央（業主 2026-11-15）：儲存課程主講人／章節分享者的職稱時，若中央詞庫還沒有這個詞，就放進待送清單並嘗試送出。
 * 失敗、中央還沒開放「新增職稱」都不影響課程儲存，之後再儲存時自動補送。
 */
async function noteJobTitle(ctx: Ctx, value: string | undefined): Promise<void> {
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

async function assertCentralCenters(ctx: Ctx, labels: string[]): Promise<void> {
  const s = ctx.session;
  if (!s || s.kind !== "central" || !labels.length) return;
  const list = await centerList(s.token);
  if (!list.length) fail(503, "central_unavailable", "暫時無法取得會員中心的中心清單，請稍後再試");
  const known = new Set(list.map(centerKey));
  const bad = labels.find((l) => !known.has(centerKey(l)));
  if (bad) fail(400, "unknown_center", `「${bad}」不在會員中心的中心清單裡；中心名稱以會員中心為準，行動大學不能自行新增`);
}

/** 分類可以複選：存成「、」分隔的文字（例如「達標班、會議」）。 */
const CAT_SEP = "、";
const splitCats = (v: string): string[] => [...new Set(v.split(/[、,，;；\n]+/).map((x) => x.trim()).filter(Boolean))];
const joinCats = (list: string[]): string => list.join(CAT_SEP);

// ---------- 關鍵字（分類、系列、場地）：超級管理員集中管理 ----------
const KEYWORD_COLUMN = { category: "category", series: "series", location: "location" } as const;
type KeywordKind = keyof typeof KEYWORD_COLUMN;
const keywordKind = (v: unknown): KeywordKind => (v === "category" || v === "series" || v === "location" ? v : fail(400, "invalid_kind", "關鍵字類型不正確"));
const keywordText = (v: unknown): string => {
  const t = typeof v === "string" ? v.trim().slice(0, 60) : "";
  return t || fail(400, "invalid_keyword", "請輸入關鍵字");
};

/** 課程編輯頁「已有的…」選項：課程已經用過的值＋超級管理員預先建立的（centerKey 不為 null 時，已用過的只算自己中心的課程）。 */
async function keywordChoices(ctx: Ctx, kind: KeywordKind, centerKey: string | null): Promise<string[]> {
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
async function rewriteCategories(ctx: Ctx, fn: (list: string[]) => string): Promise<D1PreparedStatement[]> {
  const { results } = await ctx.db.prepare("SELECT id, category FROM courses WHERE category <> ''").all<{ id: string; category: string }>();
  return results.flatMap((r) => {
    const next = fn(splitCats(r.category));
    return next === r.category ? [] : [ctx.db.prepare("UPDATE courses SET category = ? WHERE id = ?").bind(next, r.id)];
  });
}

type ShortLinkItem = { kind: "category" | "series" | "center"; value: string; slug: string | null };
/** 短網址設定清單：所有分類與系列（含還沒設定縮寫的），各帶目前的縮寫。 */
async function aiModelsView(ctx: Ctx) {
  return { jobs: AI_JOBS, models: AI_MODELS, selection: await loadSelection(ctx.db), usage: await usageSummary(ctx.db), keys: keyStatuses(ctx.env) };
}

async function listShortLinks(ctx: Ctx): Promise<ShortLinkItem[]> {
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

type KeywordItem = { value: string; count: number; preset: boolean; edmUrl?: string | null };
async function listKeywords(ctx: Ctx): Promise<Record<KeywordKind, KeywordItem[]>> {
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
async function duplicateCourse(ctx: Ctx, id: string, admin: Session) {
  const row = await ctx.db.prepare("SELECT * FROM courses WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!row) return fail(404, "not_found", "找不到這門課程");
  const { results: lessons } = await ctx.db
    .prepare("SELECT title, sharer, sharer_rank, sharer_title, position, duration_minutes, media_type, media_ref, start_seconds, end_seconds, kind, is_full FROM lessons WHERE course_id = ? ORDER BY position")
    .bind(id)
    .all<{ title: string; sharer: string; sharer_rank: string; sharer_title: string; position: number; duration_minutes: number; media_type: MediaType; media_ref: string | null; start_seconds: number | null; end_seconds: number | null; kind: string; is_full: number }>();
  const newId = `c${randomId(7)}`;
  const series = String(row.series || "").trim() || String(row.title ?? "").slice(0, 60);
  const max = await ctx.db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM courses").first<{ m: number }>();
  const keep = ["subtitle", "teacher", "teacher_rank", "teacher_title", "category", "price_twd", "min_rank_code", "theme", "description", "guidance_unit", "host_unit", "host_center_key", "review_group_id", "allow_president", "is_public", "price_tba", "hide_home", "diamond_free", "location", "location_none", "is_online", "chapter_covers", "auto_cover", "center_course"];
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
function speakerSync(db: D1Database, courseId: string): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE lessons SET title = (SELECT substr(c.title, 1, 120) FROM courses c WHERE c.id = lessons.course_id), sharer = (SELECT COALESCE(c.teacher, '') FROM courses c WHERE c.id = lessons.course_id), sharer_rank = (SELECT COALESCE(c.teacher_rank, '') FROM courses c WHERE c.id = lessons.course_id), sharer_title = (SELECT COALESCE(c.teacher_title, '') FROM courses c WHERE c.id = lessons.course_id) WHERE course_id = ? AND is_speaker = 1",
    )
    .bind(courseId);
}

async function updateCourse(ctx: Ctx, id: string) {
  const { s: admin, can } = await courseRightsFor(ctx, id);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const cur = await ctx.db.prepare("SELECT status, host_center_key, guidance_unit, review_group_id, price_twd, is_public, price_tba, updated_at, edited_by_name FROM courses WHERE id = ?").bind(id).first<{ status: string; host_center_key: string | null; guidance_unit: string; review_group_id: string | null; price_twd: number; is_public: number; price_tba: number; updated_at: string; edited_by_name: string }>();
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
  if (newHost && newHost[1] !== cur.host_center_key) sets.push(["url_name", null]);
  const pick = (col: string, old: unknown) => (sets.find(([c]) => c === col) ?? [col, old])[1];
  checkPublicFree(Number(pick("price_twd", cur.price_twd)), pick("is_public", cur.is_public) === 1, pick("price_tba", cur.price_tba) === 1);
  await checkGuidanceGroup(ctx, pick("guidance_unit", cur.guidance_unit), pick("review_group_id", cur.review_group_id));
  const [res] = await ctx.db.batch([
    ctx.db.prepare(`UPDATE courses SET ${sets.map(([c]) => `${c} = ?`).join(", ")}, updated_at = ?, edited_by_name = ?, edited_at = ? WHERE id = ?`).bind(...sets.map(([, v]) => v), iso(), admin.name.slice(0, 60), iso(), id),
    // 主講人章節的名稱、分享者、獎銜、職稱永遠等於課程基本資料：課程改了就一起同步。
    ...(sets.some(([c]) => ["title", "teacher", "teacher_rank", "teacher_title"].includes(c)) ? [speakerSync(ctx.db, id)] : []),
    audit(ctx.db, admin.sub, "course.update", "course", id, sets.map(([c]) => c).join(",")),
  ]);
  if (res.meta?.changes === 0) fail(404, "not_found", "找不到這門課程");
  await ensureCourseUrl(ctx, id);
  return courseDetail(ctx, id);
}

async function renumber(db: D1Database, courseId: string) {
  const { results } = await db.prepare("SELECT id FROM lessons WHERE course_id = ? ORDER BY position").bind(courseId).all<{ id: string }>();
  await db.batch([
    db.prepare("UPDATE lessons SET position = -position WHERE course_id = ?").bind(courseId),
    ...results.map((r, i) => db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(i + 1, r.id)),
  ]);
}

const seconds = (v: unknown): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 24 * 3600) fail(400, "invalid_time", "時間格式不正確");
  return n;
};

/** 修改章節：名稱、影片來源（示範／YouTube／Mux）、時間軸區間。音檔由上傳流程設定。 */
async function updateLesson(ctx: Ctx, id: string, admin: Session) {
  const body = await readJson<{ isSpeaker?: unknown; isSummary?: unknown; eventDate?: unknown; title?: unknown; sharer?: unknown; sharerRank?: unknown; sharerTitle?: unknown; mediaType?: unknown; mediaRef?: unknown; minutes?: unknown; startSeconds?: unknown; endSeconds?: unknown; autoCover?: unknown }>(ctx.req);
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
    if (body.isSpeaker === true && cur.kind !== "chapter") fail(400, "speaker_chapter_only", "只有章節可以設為主講人");
    if (body.isSpeaker === true) clearSpeaker.push(ctx.db.prepare("UPDATE lessons SET is_speaker = 0 WHERE course_id = ? AND is_speaker = 1 AND id <> ?").bind(cur.course_id, id));
    sets.push(["is_speaker", body.isSpeaker === true ? 1 : 0]);
    if (body.isSpeaker === true && body.isSummary === undefined) sets.push(["is_summary", 0]); // 與「總結與銷售課程」互斥
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
    sets.push(["media_type", t], ["media_ref", mediaRef]);
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
  const nowSpeaker = body.isSpeaker === undefined ? body.isSummary === true ? false : cur.is_speaker === 1 : body.isSpeaker === true;
  const speakerCols = ["title", "sharer", "sharer_rank", "sharer_title"];
  // 「總結」章節的名稱固定就是「總結」（業主 2026-11-16）：勾選當下與之後的每次修改，伺服器都強制。
  const nowSummary = body.isSummary === undefined ? cur.is_summary === 1 && body.isSpeaker !== true : body.isSummary === true;
  const speakerSets = nowSpeaker ? sets.filter(([c]) => !speakerCols.includes(c)) : sets;
  const finalSets: [string, unknown][] = nowSummary ? [...speakerSets.filter(([c]) => c !== "title"), ["title", SUMMARY_TITLE]] : speakerSets;
  await ctx.db.batch([
    ...clearSpeaker,
    ...clearSummary,
    ...(finalSets.length ? [ctx.db.prepare(`UPDATE lessons SET ${finalSets.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`).bind(...finalSets.map(([, v]) => v), id)] : []),
    ...(nowSpeaker ? [speakerSync(ctx.db, cur.course_id)] : []),
    audit(ctx.db, admin.sub, "lesson.update", "lesson", id, sets.map(([c]) => c).join(",")),
  ]);
  if (cur.media_type === "audio" && type !== "audio" && cur.media_ref) await ctx.env.MEDIA?.delete(cur.media_ref).catch(() => undefined);
  const row = await ctx.db.prepare("SELECT media_type, media_ref FROM lessons WHERE id = ?").bind(id).first<{ media_type: string; media_ref: string | null }>();
  return { ok: true, mediaType: row?.media_type, mediaRef: row?.media_ref };
}

// ---------- 審核群組、通知範圍 ----------

/** 這位登入者看得到的通知：自己的、（管理員）寄給總部的、（會長）寄給自己中心會長的。 */
function noticeScope(s: Session): { sql: string; args: unknown[] } {
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
const canManageCenter = (s: Session, key: string) => !!s.center && s.center.key === key && (s.roles.includes("president") || s.roles.includes("sound"));

async function requireGroupManager(ctx: Ctx, groupId: string): Promise<Session> {
  const s = requireMember(ctx);
  const g = await ctx.db.prepare("SELECT owner_center_key FROM review_groups WHERE id = ?").bind(groupId).first<{ owner_center_key: string | null }>();
  if (!g) return fail(404, "not_found", "找不到這個審核群組");
  // 總部群組（owner_center_key 為 NULL）只有秘書與超級管理員可以指派。
  if (s.role !== "admin" && !(g.owner_center_key && canManageCenter(s, g.owner_center_key))) fail(403, "forbidden", "沒有管理這個群組的權限");
  return s;
}

async function listGroups(ctx: Ctx): Promise<ReviewGroup[]> {
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

const isoOrNull = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) fail(400, "invalid_date", "日期格式不正確");
  return d.toISOString();
};

// ---------- 課程留言板 ----------

type CommentRow = { id: string; course_id: string; member_sub: string; member_name: string; body: string; status: "visible" | "hidden"; created_at: string; reports?: number; course_title?: string };
const toComment = (r: CommentRow, s: Session): CourseComment => ({
  id: r.id,
  courseId: r.course_id,
  authorName: r.member_name,
  mine: r.member_sub === s.sub,
  body: r.body,
  hidden: r.status === "hidden",
  createdAt: r.created_at,
  ...(r.reports !== undefined ? { reports: r.reports, courseTitle: r.course_title } : {}),
});

async function requireCourseForComments(ctx: Ctx, courseId: string): Promise<Session> {
  const s = requireMember(ctx);
  const c = await ctx.db.prepare("SELECT status FROM courses WHERE id = ?").bind(courseId).first<{ status: string }>();
  // 未上架的課程不開放留言；下架封存的課程，已報名的學員照常可以看與留言。
  if (!c || (c.status === "draft" && s.role !== "admin")) fail(404, "not_found", "找不到這門課程");
  return s;
}

async function listComments(ctx: Ctx, courseId: string): Promise<CourseComment[]> {
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

type Handler = (ctx: Ctx, params: string[]) => Promise<unknown>;
const routes: [string, RegExp, Handler][] = [
  ["GET", /^\/health$/, async () => ({ ok: true })],
  ["GET", /^\/ranks$/, async (ctx) => [...(await ranks(ctx.db)).values()]],
  ["GET", /^\/config$/, async (ctx) => ({ demoLogin: demoEnabled(ctx.env) })],
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
    "GET",
    /^\/me\/notification-settings$/,
    async (ctx) => {
      const s = requireMember(ctx);
      await syncContact(ctx, s).catch(() => undefined);
      return contactSettings(ctx, s);
    },
  ],
  [
    "PUT",
    /^\/me\/notification-settings$/,
    async (ctx) => {
      const s = requireMember(ctx);
      const body = await readJson<{ email?: unknown; notifyEmail?: unknown }>(ctx.req);
      let email: string | null | undefined;
      if (body.email !== undefined) {
        if (body.email === null || body.email === "") email = null;
        else if (typeof body.email === "string" && validEmail(body.email.trim())) email = body.email.trim().toLowerCase();
        else return fail(400, "invalid_email", "Email 格式不正確");
      }
      if (body.notifyEmail !== undefined && typeof body.notifyEmail !== "boolean") return fail(400, "invalid_request", "通知方式格式不正確");
      await syncContact(ctx, s).catch(() => undefined);
      if (email !== undefined) {
        // 正本在會員中心：先寫回中央，成功才更新這裡的副本。
        if (s.kind === "central" && !(await saveContactEmail(s.sub, s.token, email))) return fail(502, "central_unavailable", "會員中心暫時無法儲存，請稍後再試");
        // 中央會員不在本地留副本；只有模擬會員（測試）寫本地欄位。
        if (s.kind !== "central")
          await ctx.db
            .prepare("INSERT INTO member_contacts (member_sub, email) VALUES (?, ?) ON CONFLICT(member_sub) DO UPDATE SET email = excluded.email, synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
            .bind(s.sub, email)
            .run();
      }
      if (typeof body.notifyEmail === "boolean") {
        await ctx.db
          .prepare("INSERT INTO member_contacts (member_sub, notify_email) VALUES (?, ?) ON CONFLICT(member_sub) DO UPDATE SET notify_email = excluded.notify_email")
          .bind(s.sub, body.notifyEmail ? 1 : 0)
          .run();
      }
      return contactSettings(ctx, s);
    },
  ],
  [
    "GET",
    /^\/me$/,
    async (ctx) => {
      const s = ctx.session;
      if (!s) return { member: null };
      // fresh=1（開啟 App／重新整理／回到前景時）：丟掉這位會員在記憶體裡的會員中心資料快取，獎銜等資料立刻拿最新的。
      if (s.kind === "central" && ctx.url.searchParams.get("fresh") === "1") forgetMember(s.sub);
      const { results } = await ctx.db.prepare("SELECT DISTINCT duty FROM review_group_members WHERE member_sub = ?").bind(s.sub).all<{ duty: Duty }>();
      // 被指派為窗口的人登入時，補上／更新名單上的姓名。
      if (results.length) await ctx.db.prepare("UPDATE review_group_members SET member_name = ? WHERE member_sub = ? AND member_name <> ?").bind(s.name, s.sub, s.name).run();
      const labels: Record<Duty, string> = { register: "報名窗口", collect: "收費窗口", review: "審核員" };
      // 向會員中心的幾個查詢彼此獨立，同時送出（以前是一個接一個，首頁會慢）。
      const central = s.kind === "central" ? s : null;
      const [, rankMap, rv, opts, missing, badgeMap] = await Promise.all([
        syncContact(ctx, s).catch(() => undefined),
        ranks(ctx.db),
        central ? rankValue(central.sub, central.token).catch(() => undefined) : undefined,
        central ? rankOptions(central.token).catch(() => new Map<string, string>()) : undefined,
        central ? profileGaps(central.sub, central.token, null).catch(() => []) : undefined,
        central ? rankBadges(central.token).catch(() => undefined) : undefined,
      ]);
      const member = memberOf(s, rankMap, { duties: results.map((r) => labels[r.duty]) });
      member.canViewStats = await canViewStats(ctx, s).catch(() => false);
      const rights = await rightsOf(ctx);
      if (rights.any) {
        member.courseRights = { all: rights.admin, create: canCreateCourse(rights), manageEditors: rights.admin || rights.staff, center: rights.center?.label ?? null, editor: rights.editor };
        if (rights.editor) member.titles = [...new Set([...member.titles, "小編"])];
      }
      // 小編登入時更新名單上的姓名。
      await ctx.db.prepare("UPDATE course_editors SET member_name = ? WHERE member_sub = ? AND member_name <> ?").bind(s.name.slice(0, 60), s.sub, s.name.slice(0, 60)).run();
      if (central) {
        // 獎銜：值為空或「無／none」顯示「安麗寶寶」；其餘用中央選項的名稱，查不到退回本地階梯名稱。
        if (rv !== undefined) member.rankLabel = rv && rv !== "none" && rv !== "無" ? (opts?.get(rv) ?? rankLabelOf(rv, rankMap)) : "安麗寶寶";
        if (rv !== undefined) {
          // 徽章以中央為準（badge_url 完整網址＋圖案範圍）；中央沒有徽章就不顯示。暫時備援：中央讀不到時才用本地 R2 的舊圖庫。
          const b = badgeMap;
          const info = b && rv ? b.get(rv) : undefined;
          if (b && rv) {
            member.rankBadge = info?.url ?? null;
            member.rankBadgeArt = info ? { width: info.width, height: info.height, top: info.top, bottom: info.bottom } : null;
          }
        }
        // 會員中心資料有空白就提示（只傳「缺什麼」，不保存內容）。
        member.profileMissing = missing ?? [];
        // 資料不完整時，把視窗要用的資料一起帶回去（來源都已在快取，不用再問會員中心，視窗才能立刻顯示）。
        if (member.profileMissing.length) member.profileForm = (await centralProfileView(central.sub, central.token).catch(() => null)) ?? undefined;
      }
      return { member };
    },
  ],
  [
    "DELETE",
    /^\/me$/,
    async (ctx) => {
      // 清除這位會員在本 App 的所有資料（會員中心 webhook 通知刪除帳號時也走同一條）。
      const s = requireMember(ctx);
      await purgeMember(ctx.db, s.sub, s.sub, "member.delete_app_data");
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
      else if (ev.type === "member.profile_changed" && typeof ev.member_id === "string") forgetMember(ev.member_id);
      // webhook.test 與不認得的事件：只回 2xx（容忍未來新增的事件）。
      await ctx.db.batch([
        ctx.db.prepare("INSERT OR IGNORE INTO central_events (id) VALUES (?)").bind(ev.id),
        ctx.db.prepare("DELETE FROM central_events WHERE received_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')"),
      ]);
      return { ok: true };
    },
  ],
  ["GET", /^\/courses$/, async (ctx) => listCourses(ctx, false)],
  [
    "GET",
    /^\/courses\/([\w-]+)$/,
    async (ctx, [id]) => {
      await openFreeCourse(ctx, id!).catch(() => undefined); // 打開免費課程＝自動加入學習中
      return courseDetail(ctx, id!);
    },
  ],
  [
    "POST",
    /^\/courses\/([\w-]+)\/hide-learning$/,
    async (ctx, [courseId]) => {
      const s = requireMember(ctx);
      const c = await ctx.db.prepare("SELECT price_twd FROM courses WHERE id = ?").bind(courseId).first<{ price_twd: number }>();
      if (!c) return fail(404, "not_found", "找不到這門課程");
      const enrolled = await ctx.db.prepare("SELECT 1 AS ok FROM enrollments WHERE member_sub = ? AND course_id = ?").bind(s.sub, courseId).first();
      if (enrolled) {
        if (c.price_twd !== 0) fail(403, "paid_course", "付費課程不能從學習中隱藏");
        await ctx.db.prepare("UPDATE enrollments SET hidden = 1 WHERE member_sub = ? AND course_id = ?").bind(s.sub, courseId).run();
      } else {
        // 沒報名、只是播放過的課程（管理員或公開課程）：隱藏播放紀錄那一筆。
        const r = await ctx.db.prepare("UPDATE learning_started SET hidden = 1 WHERE member_sub = ? AND course_id = ?").bind(s.sub, courseId).run();
        if (r.meta?.changes === 0) return c.price_twd !== 0 ? fail(403, "paid_course", "付費課程不能從學習中隱藏") : fail(404, "not_enrolled", "這門課程不在你的學習中");
      }
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/courses\/([\w-]+)\/lessons\/([\w-]+)\/started$/,
    async (ctx, [courseId, lessonId]) => {
      const s = requireMember(ctx);
      await lessonOf(ctx, courseId, lessonId); // 找不到章節時會丟錯
      if (!(await canWatch(ctx, courseId))) fail(403, "not_enrolled", "請先報名並通過審核");
      await ensureFreeEnrollment(ctx, courseId);
      // 播放超過 1%：納入學習中（已被隱藏的也恢復顯示）。
      await ctx.db
        .prepare("INSERT INTO learning_started (member_sub, course_id) VALUES (?, ?) ON CONFLICT(member_sub, course_id) DO UPDATE SET hidden = 0")
        .bind(s.sub, courseId)
        .run();
      await ctx.db.prepare("UPDATE enrollments SET hidden = 0 WHERE member_sub = ? AND course_id = ? AND hidden = 1").bind(s.sub, courseId).run();
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/courses\/([\w-]+)\/lessons\/([\w-]+)\/watch$/,
    async (ctx, [courseId, lessonId]) => {
      const s = requireMember(ctx);
      const body = await readJson<{ ratio?: unknown; position?: unknown }>(ctx.req);
      const ratio = Number(body.ratio);
      if (!Number.isFinite(ratio) || ratio < 0) fail(400, "invalid_ratio", "播放進度不正確");
      const pos = Number(body.position);
      const position = Number.isFinite(pos) && pos >= 0 && pos < 24 * 3600 ? Math.round(pos * 10) / 10 : null;
      await lessonOf(ctx, courseId, lessonId); // 找不到章節時會丟錯
      if (!(await canWatch(ctx, courseId))) fail(403, "not_enrolled", "請先報名並通過審核");
      // 只會往前（取最大值），不會因為倒轉重看而退步。
      await ctx.db
        // ratio 只會往前（取最大值）；position_sec 是「最後播放到哪」（續播用，倒轉重看也照實記錄）。
        .prepare("INSERT INTO lesson_watch (member_sub, lesson_id, course_id, ratio, position_sec) VALUES (?, ?, ?, ?, ?) ON CONFLICT(member_sub, lesson_id) DO UPDATE SET ratio = MAX(ratio, excluded.ratio), position_sec = COALESCE(excluded.position_sec, position_sec), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
        .bind(s.sub, lessonId, courseId, Math.min(1, ratio), position)
        .run();
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/courses\/([\w-]+)\/lessons\/([\w-]+)\/complete$/,
    async (ctx, [courseId, lessonId]) => {
      const s = requireMember(ctx);
      await lessonOf(ctx, courseId, lessonId); // 找不到章節時會丟錯
      if (!(await canWatch(ctx, courseId))) fail(403, "not_enrolled", "請先報名並通過審核");
      await ensureFreeEnrollment(ctx, courseId);
      await ctx.db
        .prepare("INSERT OR IGNORE INTO lesson_progress (member_sub, lesson_id, course_id) VALUES (?, ?, ?)")
        .bind(s.sub, lessonId, courseId)
        .run();
      // 達成徽章條件就通知本人（失敗不影響進度記錄）。
      await grantAchievements(ctx, s.sub).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/courses\/([\w-]+)\/lessons\/([\w-]+)\/playback$/,
    async (ctx, [courseId, lessonId]) => {
      const lesson = await lessonOf(ctx, courseId, lessonId);
      if (!(await canWatch(ctx, courseId))) fail(ctx.session ? 403 : 401, ctx.session ? "not_enrolled" : "unauthenticated", ctx.session ? "請先報名並通過審核" : "請先登入");
      await ensureFreeEnrollment(ctx, courseId);
      // 續播記憶（業主 2026-11-17）：還沒看完的這一堂，從上次播放到的秒數接著播（離起點不到 5 秒、離結尾不到 10 秒就從頭）。
      const resumeAt = await resumePoint(ctx, lessonId, lesson.start_seconds ?? 0, lesson.end_seconds);
      const seg = { start: lesson.start_seconds, end: lesson.end_seconds, ...(resumeAt != null ? { resumeAt } : {}) };
      if (lesson.media_type === "youtube" && lesson.media_ref) return { kind: "youtube", videoId: lesson.media_ref, ...seg };
      if (lesson.media_type === "mux" && lesson.media_ref) {
        const url = await muxPlaybackUrl(ctx.env, lesson.media_ref);
        if (!url) fail(503, "media_not_ready", "影片授權服務尚未設定，請稍後再試");
        return { kind: "hls", url, ...seg };
      }
      if (lesson.media_type === "audio" && lesson.media_ref) {
        const url = await audioUrl(ctx.env, lesson.media_ref);
        if (!url) fail(503, "media_not_ready", "音檔服務尚未設定，請稍後再試");
        return { kind: "audio", url, ...seg };
      }
      return { kind: "demo", url: DEMO_VIDEO_PATH, label: "示範影片（非正式課程內容）", ...seg };
    },
  ],
  ["POST", /^\/orders$/, async (ctx) => createOrders(ctx, await readJson(ctx.req))],
  [
    "GET",
    /^\/short-links$/,
    async (ctx) => (await ctx.db.prepare("SELECT kind, value, slug FROM short_links ORDER BY kind, slug").all<{ kind: string; value: string; slug: string }>()).results,
  ],
  [
    "POST",
    /^\/center-views$/,
    async (ctx) => {
      // 中心專屬頁瀏覽計數：每進入一次就 +1（業主 2026-11-16：不分是否同一人）；回傳累計次數。
      requireMember(ctx);
      const body = await readJson<{ center?: unknown }>(ctx.req);
      const label = typeof body.center === "string" ? body.center.trim().slice(0, 60) : "";
      if (!label) fail(400, "invalid_center", "請指定中心");
      const key = centerKey(label);
      return { total: await bumpView(ctx.db, "center", key) };
    },
  ],
  [
    "GET",
    /^\/center-views$/,
    async (ctx) => {
      requireMember(ctx);
      const label = (ctx.url.searchParams.get("center") ?? "").trim();
      const n = label ? await ctx.db.prepare("SELECT total AS n FROM page_views WHERE kind = 'center' AND key = ?").bind(centerKey(label)).first<{ n: number }>() : null;
      return { total: n?.n ?? 0 };
    },
  ],
  [
    "GET",
    /^\/short-links\/([A-Za-z0-9-]{2,30})\/([A-Za-z0-9-]{3,80})$/,
    async (ctx, [slug, name]) => {
      // 課程專屬網址：中心縮寫（或總部 hq）+ 英譯姓名-編號 → 課程編號。網址不分大小寫。
      const row = slug.toLowerCase() === HQ_SLUG ? { value: "" } : await ctx.db.prepare("SELECT value FROM short_links WHERE slug = ? COLLATE NOCASE AND kind = 'center'").bind(slug).first<{ value: string }>();
      const course = row
        ? row.value
          ? await ctx.db.prepare(`SELECT id FROM courses WHERE host_center_key = ? AND url_name COLLATE NOCASE IN (${urlNameVariants(name).map(() => "?").join(",")})`).bind(centerKey(row.value), ...urlNameVariants(name)).first<{ id: string }>()
          : await ctx.db.prepare(`SELECT id FROM courses WHERE host_center_key IS NULL AND url_name COLLATE NOCASE IN (${urlNameVariants(name).map(() => "?").join(",")})`).bind(...urlNameVariants(name)).first<{ id: string }>()
        : null;
      return course ? { courseId: course.id } : fail(404, "not_found", "找不到這個網址");
    },
  ],
  [
    "GET",
    /^\/short-links\/([A-Za-z0-9-]{2,30})$/,
    async (ctx, [slug]) => {
      const row = await ctx.db.prepare("SELECT kind, value FROM short_links WHERE slug = ? COLLATE NOCASE").bind(slug).first<{ kind: string; value: string }>();
      return row ?? fail(404, "not_found", "找不到這個短網址");
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
      const { results } = await ctx.db
        .prepare(
          "SELECT l.id AS id, l.course_id AS courseId, l.position AS position, l.title, l.sharer, l.sharer_rank AS sharerRank, l.sharer_title AS sharerTitle, COALESCE(l.event_date, c.event_start) AS eventDate, l.is_speaker AS isSpeaker, l.is_summary AS isSummary, c.is_shorts AS isShorts, c.is_list AS isList, l.kind AS lessonKind, l.duration_minutes AS minutes, l.media_type AS mediaType, l.media_ref AS mediaRef, l.cover_key AS coverKey, l.art_version AS artVersion, l.auto_cover AS autoCover, (SELECT 1 FROM lesson_progress p WHERE p.lesson_id = l.id AND p.member_sub = ?) AS done FROM lessons l JOIN courses c ON c.id = l.course_id WHERE c.status = 'published' AND (l.kind = 'chapter' OR (c.is_shorts = 1 AND l.kind = 'material' AND l.media_type <> 'demo' AND l.media_ref IS NOT NULL)) ORDER BY l.course_id, l.position",
        )
        .bind(sub)
        .all<{ id: string; courseId: string; position: number; title: string; sharer: string; sharerRank: string; sharerTitle: string; eventDate: string | null; isSpeaker: number; isSummary: number; isShorts: number; isList: number; lessonKind: string; minutes: number; mediaType: string; mediaRef: string | null; coverKey: string | null; artVersion: number; autoCover: number; done: number | null }>();
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
          // 只給章節自己上傳的封面；沒有就留空，畫面依序改用「課程手動上傳的封面／EDM」→ 最後才用這一堂的 YouTube 縮圖（ytThumb）。
          // 業主 2026-11-17：手動上傳的封面一律優先，不可被 YouTube 縮圖蓋掉。
          // 素材清單裡的影片一律用 YouTube 縮圖，不用清單首頁上傳的封面（業主 2026-11-17）。
          coverUrl: r.isList === 1 && r.mediaType === "youtube" && r.mediaRef ? ytThumbUrl(r.mediaRef) : r.coverKey ? pubUrl(r.coverKey, r.artVersion) : null,
          // 沒有任何封面時的臨時封面：YouTube 影片自己的縮圖（16:9、沒有黑邊）。
          ytThumb: r.mediaType === "youtube" && r.mediaRef ? `https://i.ytimg.com/vi/${r.mediaRef}/mqdefault.jpg` : null,
          ready: (r.mediaType !== "demo" && !!r.mediaRef) || r.minutes > 0,
          completed: r.done === 1,
        })),
      };
    },
  ],
  // 全部課程的「分類」下拉：與「關鍵字管理」的分類清單同步（含目前沒有課程使用的分類）。
  ["GET", /^\/categories$/, async (ctx) => keywordChoices(ctx, "category", null)],
  ["GET", /^\/ui-config$/, async (ctx) => loadConfig(ctx.db)],
  [
    "PUT",
    /^\/admin\/ui-config$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      // 只更新有傳的欄位，其餘保留目前設定。
      const cur = await loadConfig(ctx.db);
      const bodyApp = (body.app && typeof body.app === "object" ? body.app : {}) as { rec?: object };
      const next = normalizeConfig({ ...cur, ...body, ribbons: { ...cur.ribbons, ...((body.ribbons as object) ?? {}) }, app: { ...cur.app, ...bodyApp, rec: { ...cur.app.rec, ...(bodyApp.rec ?? {}) } }, share: { ...cur.share, ...((body.share as object) ?? {}) } });
      await saveConfig(ctx.db, next);
      await audit(ctx.db, s.sub, "ui_config.update", "ui_config", "ui_config", Object.keys(body).join(",")).run();
      return next;
    },
  ],
  [
    "GET",
    /^\/admin\/stats\/mux$/,
    async (ctx) => {
      const s = requireMember(ctx);
      if (!(await canViewStats(ctx, s))) fail(403, "forbidden", "沒有查看統計分析的權限");
      return collectMuxStats(ctx.env);
    },
  ],
  [
    "GET",
    /^\/admin\/stats\/app$/,
    async (ctx) => {
      const s = requireMember(ctx);
      if (!(await canViewStats(ctx, s))) fail(403, "forbidden", "沒有查看統計分析的權限");
      return collectAppStats(ctx.db);
    },
  ],
  [
    "GET",
    /^\/admin\/stats\/cloudflare$/,
    async (ctx) => {
      const s = requireMember(ctx);
      if (!(await canViewStats(ctx, s))) fail(403, "forbidden", "沒有查看統計分析的權限");
      return collectCfStats(ctx.env);
    },
  ],
  ["GET", /^\/me\/achievements$/, async (ctx) => grantAchievements(ctx, requireMember(ctx).sub)],
  ["GET", /^\/admin\/achievements$/, async (ctx) => (requireSuperAdmin(ctx), listAchievements(ctx))],
  [
    "POST",
    /^\/admin\/achievements$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const sets = await achievementBody(ctx, body, true);
      if (sets.find(([c]) => c === "condition_type")?.[1] === "course_completed" && !sets.find(([c]) => c === "course_id")?.[1]) fail(400, "course_required", "請選擇要學完的課程");
      const id = `ach-${randomId(8)}`;
      const max = await ctx.db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM achievements").first<{ m: number }>();
      const cols = ["id", "sort_order", ...sets.map(([c]) => c)];
      await ctx.db.batch([
        ctx.db.prepare(`INSERT INTO achievements (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(id, (max?.m ?? 0) + 1, ...sets.map(([, v]) => v)),
        audit(ctx.db, s.sub, "achievement.create", "achievement", id, String(body.name ?? "")),
      ]);
      return listAchievements(ctx);
    },
  ],
  [
    "PATCH",
    /^\/admin\/achievements\/([\w-]+)$/,
    async (ctx, [id]) => {
      const s = requireSuperAdmin(ctx);
      const sets = await achievementBody(ctx, await readJson<Record<string, unknown>>(ctx.req), false);
      if (!sets.length) fail(400, "nothing_to_update", "沒有要更新的欄位");
      const [res] = await ctx.db.batch([ctx.db.prepare(`UPDATE achievements SET ${sets.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`).bind(...sets.map(([, v]) => v), id), audit(ctx.db, s.sub, "achievement.update", "achievement", id, sets.map(([c]) => c).join(","))]);
      if (res.meta?.changes === 0) return fail(404, "not_found", "找不到這個徽章");
      return listAchievements(ctx);
    },
  ],
  [
    "DELETE",
    /^\/admin\/achievements\/([\w-]+)$/,
    async (ctx, [id]) => {
      const s = requireSuperAdmin(ctx);
      const [, , res] = await ctx.db.batch([ctx.db.prepare("DELETE FROM member_achievements WHERE achievement_id = ?").bind(id), audit(ctx.db, s.sub, "achievement.delete", "achievement", id), ctx.db.prepare("DELETE FROM achievements WHERE id = ?").bind(id)]);
      if (res.meta?.changes === 0) return fail(404, "not_found", "找不到這個徽章");
      return listAchievements(ctx);
    },
  ],

  ["POST", /^\/orders\/([\w-]+)\/cancel$/, async (ctx, [id]) => cancelOrder(ctx, id)],
  ["POST", /^\/orders\/([\w-]+)\/payments$/, async (ctx, [id]) => reportPayment(ctx, id!, await readJson(ctx.req))],
  [
    "DELETE",
    /^\/orders\/([\w-]+)\/payments\/([\w-]+)$/,
    async (ctx, [orderId, payId]) => {
      const s = requireMember(ctx);
      const o = await ctx.db.prepare("SELECT member_sub, status FROM orders WHERE id = ?").bind(orderId).first<{ member_sub: string; status: string }>();
      if (!o || o.member_sub !== s.sub) return fail(404, "not_found", "找不到這筆報名");
      if (o.status !== "pending") fail(409, "not_pending", "這筆報名已處理完畢，不能刪除回報紀錄");
      const r = await ctx.db.prepare("DELETE FROM order_payments WHERE id = ? AND order_id = ?").bind(payId, orderId).run();
      if (r.meta?.changes === 0) return fail(404, "not_found", "找不到這筆回報");
      await audit(ctx.db, s.sub, "order.payment_delete", "order", orderId, payId).run();
      return orderDetail(ctx, orderId);
    },
  ],
  [
    "POST",
    /^\/courses\/([\w-]+)\/cancel-registration$/,
    async (ctx, [courseId]) => {
      // 從課程頁取消：找出自己這門課可取消的報名。
      const s = requireMember(ctx);
      const row = await ctx.db
        .prepare("SELECT o.id FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.member_sub = ? AND i.course_id = ? AND (o.status = 'pending' OR (o.status = 'opened' AND o.pay_method = 'free')) LIMIT 1")
        .bind(s.sub, courseId)
        .first<{ id: string }>();
      if (!row) return fail(409, "not_cancellable", "找不到可以取消的報名（已繳費開通的報名請聯絡報名窗口）");
      return cancelOrder(ctx, row.id);
    },
  ],

  [
    "GET",
    /^\/orders$/,
    async (ctx) => {
      const s = requireMember(ctx);
      const { results } = await ctx.db.prepare(`${ORDER_SELECT} WHERE o.member_sub = ? ORDER BY o.created_at DESC LIMIT 200`).bind(s.sub).all<OrderRow>();
      return hydrateOrders(ctx.db, results);
    },
  ],
  ["GET", /^\/orders\/([\w-]+)$/, async (ctx, [id]) => orderDetail(ctx, id)],
  ["POST", /^\/orders\/([\w-]+)\/events$/, async (ctx, [id]) => addOrderEvent(ctx, id, await readJson(ctx.req))],
  [
    "GET",
    /^\/notifications$/,
    async (ctx) => {
      const s = requireMember(ctx);
      const n = noticeScope(s);
      const { results } = await ctx.db
        .prepare(`SELECT id, title, body, link, read_at, created_at FROM notifications WHERE ${n.sql} ORDER BY created_at DESC LIMIT 100`)
        .bind(...n.args)
        .all<{ id: string; title: string; body: string; link: string; read_at: string | null; created_at: string }>();
      return results.map((x): Notice => ({ id: x.id, title: x.title, body: x.body, link: x.link, read: !!x.read_at, createdAt: x.created_at }));
    },
  ],
  [
    "POST",
    /^\/notifications\/read-all$/,
    async (ctx) => {
      const n = noticeScope(requireMember(ctx));
      await ctx.db.prepare(`UPDATE notifications SET read_at = ? WHERE read_at IS NULL AND ${n.sql}`).bind(iso(), ...n.args).run();
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/notifications\/([\w-]+)\/read$/,
    async (ctx, [id]) => {
      const n = noticeScope(requireMember(ctx));
      await ctx.db.prepare(`UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND ${n.sql}`).bind(iso(), id, ...n.args).run();
      return { ok: true };
    },
  ],
  ["GET", /^\/admin\/orders$/, async (ctx) => hydrateOrders(ctx.db, (await reviewList(ctx)).rows.slice(0, 300))],
  ["GET", /^\/admin\/orders\.csv$/, async (ctx) => reviewCsv(ctx)],
  ["GET", /^\/admin\/reports\/registrations$/, async (ctx) => registrationReport(ctx)],
  ["GET", /^\/admin\/reports\/registrations\.csv$/, async (ctx) => registrationReportCsv(ctx)],
  ["POST", /^\/admin\/orders\/([\w-]+)\/review$/, async (ctx, [id]) => reviewOrder(ctx, id, await readJson(ctx.req))],
  [
    "GET",
    /^\/centers$/,
    async (ctx) => {
      const s = requireMember(ctx);
      // 只用會員中心的清單（正本）。不混入本地資料；中央暫時查不到時，用最近一次成功的清單，還是沒有就回報錯誤。
      if (s.kind !== "central") return ["台北中心", "台中中心", "高雄中心"];
      const list = await centerList(s.token);
      if (!list.length) fail(503, "central_unavailable", "暫時無法取得會員中心的中心清單，請稍後再試");
      return list;
    },
  ],
  ["GET", /^\/courses\/([\w-]+)\/comments$/, async (ctx, [id]) => listComments(ctx, id)],
  [
    "POST",
    /^\/courses\/([\w-]+)\/comments$/,
    async (ctx, [courseId]) => {
      const s = await requireCourseForComments(ctx, courseId);
      const body = text((await readJson<{ body?: unknown }>(ctx.req)).body, 500) || fail(400, "empty", "請輸入留言內容");
      const recent = await ctx.db.prepare("SELECT COUNT(*) AS n FROM course_comments WHERE member_sub = ? AND created_at > ?").bind(s.sub, iso(new Date(Date.now() - 600_000))).first<{ n: number }>();
      if ((recent?.n ?? 0) >= 5) fail(429, "too_many", "留言太頻繁了，請稍後再試");
      await ctx.db.prepare("INSERT INTO course_comments (id, course_id, member_sub, member_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), courseId, s.sub, s.name, body, iso()).run();
      return listComments(ctx, courseId);
    },
  ],
  [
    "DELETE",
    /^\/comments\/([\w-]+)$/,
    async (ctx, [id]) => {
      const s = requireMember(ctx);
      const res = await ctx.db.prepare("DELETE FROM course_comments WHERE id = ? AND member_sub = ?").bind(id, s.sub).run();
      if (res.meta?.changes === 0) fail(404, "not_found", "找不到這則留言");
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/comments\/([\w-]+)\/report$/,
    async (ctx, [id]) => {
      const s = requireMember(ctx);
      const c = await ctx.db.prepare("SELECT c.member_sub, c.body, k.title FROM course_comments c JOIN courses k ON k.id = c.course_id WHERE c.id = ? AND c.status = 'visible'").bind(id).first<{ member_sub: string; body: string; title: string }>();
      if (!c) return fail(404, "not_found", "找不到這則留言");
      if (c.member_sub === s.sub) fail(400, "own_comment", "不能檢舉自己的留言");
      const reason = text((await readJson<{ reason?: unknown }>(ctx.req)).reason, 200) ?? "";
      const first = !(await ctx.db.prepare("SELECT 1 AS ok FROM comment_reports WHERE comment_id = ? LIMIT 1").bind(id).first());
      await ctx.db.batch([
        ctx.db.prepare("INSERT OR IGNORE INTO comment_reports (comment_id, reporter_sub, reason) VALUES (?, ?, ?)").bind(id, s.sub, reason),
        // 同一則留言只在第一次被檢舉時通知總部，避免洗版。
        ...(first ? [notify(ctx.db, { role: "admin" }, "有留言被檢舉", `${c.title}：${c.body.slice(0, 60)}`, "/admin/comments")] : []),
      ]);
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/comments\/([\w-]+)\/block$/,
    async (ctx, [id]) => {
      const s = requireMember(ctx);
      const c = await ctx.db.prepare("SELECT member_sub FROM course_comments WHERE id = ?").bind(id).first<{ member_sub: string }>();
      if (!c) return fail(404, "not_found", "找不到這則留言");
      if (c.member_sub === s.sub) fail(400, "own_comment", "不能封鎖自己");
      await ctx.db.prepare("INSERT OR IGNORE INTO comment_blocks (member_sub, blocked_sub) VALUES (?, ?)").bind(s.sub, c.member_sub).run();
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/admin\/comments$/,
    async (ctx) => {
      const s = requireAdmin(ctx);
      const { results } = await ctx.db
        .prepare(
          `SELECT c.id, c.course_id, c.member_sub, c.member_name, c.body, c.status, c.created_at, k.title AS course_title,
           (SELECT COUNT(*) FROM comment_reports r WHERE r.comment_id = c.id) AS reports
           FROM course_comments c JOIN courses k ON k.id = c.course_id
           WHERE c.status = 'hidden' OR EXISTS (SELECT 1 FROM comment_reports r WHERE r.comment_id = c.id)
           ORDER BY c.created_at DESC LIMIT 200`,
        )
        .all<CommentRow>();
      return results.map((r) => toComment(r, s));
    },
  ],
  [
    "PATCH",
    /^\/admin\/comments\/([\w-]+)$/,
    async (ctx, [id]) => {
      const s = requireAdmin(ctx);
      const body = await readJson<{ hidden?: unknown; dismiss?: unknown }>(ctx.req);
      const statements = [audit(ctx.db, s.sub, body.dismiss === true ? "comment.dismiss_reports" : body.hidden === true ? "comment.hide" : "comment.show", "comment", id)];
      if (body.dismiss === true) statements.push(ctx.db.prepare("DELETE FROM comment_reports WHERE comment_id = ?").bind(id));
      else statements.push(ctx.db.prepare("UPDATE course_comments SET status = ?, hidden_by_sub = ? WHERE id = ?").bind(body.hidden === true ? "hidden" : "visible", body.hidden === true ? s.sub : null, id));
      await ctx.db.batch(statements);
      return { ok: true };
    },
  ],
  ["GET", /^\/admin\/review-groups$/, async (ctx) => listGroups(ctx)],
  [
    "POST",
    /^\/admin\/review-groups$/,
    async (ctx) => {
      const s = requireMember(ctx);
      const body = await readJson<{ name?: unknown; ownerCenter?: unknown }>(ctx.req);
      const name = text(body.name, 60) || fail(400, "name_required", "請輸入群組名稱");
      // 總部群組只有秘書與超級管理員可建立；會長、音控只能建立自己中心的群組。
      const own = text(body.ownerCenter, 100) || null;
      if (s.role !== "admin" && !(own && canManageCenter(s, centerKey(own)))) fail(403, "forbidden", "沒有建立這個群組的權限");
      if (own) await assertCentralCenters(ctx, [own]);
      const id = `g${randomId(8)}`;
      await ctx.db.batch([
        ctx.db.prepare("INSERT INTO review_groups (id, name, owner_center_key, owner_center_label, created_by_sub) VALUES (?, ?, ?, ?, ?)").bind(id, name, own ? centerKey(own) : null, own ?? "", s.sub),
        audit(ctx.db, s.sub, "group.create", "review_group", id, name),
      ]);
      return listGroups(ctx);
    },
  ],
  [
    "PATCH",
    /^\/admin\/review-groups\/([\w-]+)$/,
    async (ctx, [id]) => {
      const s = await requireGroupManager(ctx, id);
      const name = text((await readJson<{ name?: unknown }>(ctx.req)).name, 60) || fail(400, "name_required", "請輸入群組名稱");
      await ctx.db.batch([ctx.db.prepare("UPDATE review_groups SET name = ? WHERE id = ?").bind(name, id), audit(ctx.db, s.sub, "group.rename", "review_group", id, name)]);
      return listGroups(ctx);
    },
  ],
  [
    "DELETE",
    /^\/admin\/review-groups\/([\w-]+)$/,
    async (ctx, [id]) => {
      const s = await requireGroupManager(ctx, id);
      await ctx.db.batch([
        ctx.db.prepare("UPDATE courses SET review_group_id = NULL WHERE review_group_id = ?").bind(id),
        ctx.db.prepare("DELETE FROM review_groups WHERE id = ?").bind(id),
        audit(ctx.db, s.sub, "group.delete", "review_group", id),
      ]);
      return listGroups(ctx);
    },
  ],
  [
    "POST",
    /^\/admin\/review-groups\/([\w-]+)\/members$/,
    async (ctx, [id]) => {
      const s = await requireGroupManager(ctx, id);
      const body = await readJson<{ memberSub?: unknown; duty?: unknown; center?: unknown; remove?: unknown }>(ctx.req);
      const sub = typeof body.memberSub === "string" ? body.memberSub.trim() : "";
      if (!/^[\w-]{3,128}$/.test(sub)) fail(400, "invalid_member", "請貼上正確的會員 ID（對方在「設定」頁可以看到）");
      if (body.duty !== "register" && body.duty !== "collect" && body.duty !== "review") fail(400, "invalid_duty", "請選擇職責");
      const label = text(body.center, 100) ?? "";
      const key = label ? centerKey(label) : "";
      if (body.remove === true) {
        await ctx.db.batch([
          ctx.db.prepare("DELETE FROM review_group_members WHERE group_id = ? AND center_key = ? AND member_sub = ? AND duty = ?").bind(id, key, sub, body.duty),
          audit(ctx.db, s.sub, "group.member_remove", "review_group", id, `${sub}:${body.duty}`),
        ]);
        return listGroups(ctx);
      }
      if (label) await assertCentralCenters(ctx, [label]);
      // 姓名：先用對方曾留下的報名姓名；對方下次登入時會自動更新。
      const known = await ctx.db
        .prepare("SELECT member_name AS n FROM review_group_members WHERE member_sub = ? AND member_name <> '' UNION SELECT member_name_snapshot FROM orders WHERE member_sub = ? LIMIT 1")
        .bind(sub, sub)
        .first<{ n: string }>();
      await ctx.db.batch([
        ctx.db
          .prepare("INSERT OR IGNORE INTO review_group_members (group_id, center_key, center_label, member_sub, member_name, duty, added_by_sub) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(id, key, label, sub, sub === s.sub ? s.name : (known?.n ?? ""), body.duty, s.sub),
        audit(ctx.db, s.sub, "group.member_add", "review_group", id, `${sub}:${body.duty}`),
        notify(ctx.db, { sub }, "你已被指派為課程報名審核人員", `群組：${(await ctx.db.prepare("SELECT name FROM review_groups WHERE id = ?").bind(id).first<{ name: string }>())?.name ?? ""}${label ? `｜${label}` : "｜全部中心"}`, "/admin/orders"),
      ]);
      return listGroups(ctx);
    },
  ],
  [
    "PATCH",
    /^\/admin\/lessons\/([\w-]+)$/,
    async (ctx, [id]) => updateLesson(ctx, id, await requireLessonManager(ctx, id)),
  ],
  [
    "DELETE",
    /^\/admin\/lessons\/([\w-]+)$/,
    async (ctx, [id]) => {
      const admin = requireAdmin(ctx);
      const lesson = await ctx.db.prepare("SELECT course_id, media_type, media_ref FROM lessons WHERE id = ?").bind(id).first<{ course_id: string; media_type: string; media_ref: string | null }>();
      if (!lesson) return fail(404, "not_found", "找不到這個章節");
      const files = await attachmentKeys(ctx.db, "lesson_id", id);
      const lart = await ctx.db.prepare("SELECT cover_key, poster_key FROM lessons WHERE id = ?").bind(id).first<{ cover_key: string | null; poster_key: string | null }>();
      files.push(...[lart?.cover_key, lart?.poster_key].filter((k): k is string => !!k));
      await ctx.db.batch([ctx.db.prepare("DELETE FROM lessons WHERE id = ?").bind(id), audit(ctx.db, admin.sub, "lesson.delete", "lesson", id)]);
      await renumber(ctx.db, lesson.course_id);
      // 完整版課程影片可能與章節共用同一個音檔：還有別的章節在用就不刪檔。
      const shared = lesson.media_ref ? await ctx.db.prepare("SELECT 1 AS ok FROM lessons WHERE media_ref = ? LIMIT 1").bind(lesson.media_ref).first() : null;
      if (lesson.media_type === "audio" && lesson.media_ref && !shared) await ctx.env.MEDIA?.delete(lesson.media_ref).catch(() => undefined);
      for (const k of files) await ctx.env.MEDIA?.delete(k).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/admin\/lessons\/([\w-]+)\/check$/,
    async (ctx, [id]) => {
      await requireLessonManager(ctx, id);
      const l = await ctx.db.prepare("SELECT media_type, media_ref FROM lessons WHERE id = ?").bind(id).first<{ media_type: string; media_ref: string | null }>();
      if (!l) return fail(404, "not_found", "找不到這個章節");
      if (l.media_type === "mux" && l.media_ref) return checkMuxPlayback(ctx.env, l.media_ref);
      if (l.media_type === "audio" && l.media_ref) {
        const head = await ctx.env.MEDIA?.head(l.media_ref);
        return head ? { ok: true, message: `音檔正常（${Math.round(head.size / 1024 / 1024)} MB）` } : { ok: false, message: "找不到音檔，請重新上傳" };
      }
      return { ok: true, message: "這個來源不需要檢查" };
    },
  ],
  [
    "POST",
    /^\/admin\/lessons\/([\w-]+)\/audio\/start$/,
    async (ctx, [id]) => {
      const admin = await requireLessonManager(ctx, id);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "音檔儲存空間尚未啟用");
      const body = await readJson<{ fileName?: unknown; contentType?: unknown; size?: unknown }>(ctx.req);
      const type = typeof body.contentType === "string" ? body.contentType : "";
      if (!/^audio\/[\w.+-]+$/.test(type)) fail(400, "invalid_audio", "請選擇音訊檔（例如 MP3、M4A）");
      if (typeof body.size !== "number" || body.size <= 0 || body.size > 2 * 1024 ** 3) fail(400, "invalid_size", "音檔大小需小於 2GB");
      if (!(await ctx.db.prepare("SELECT 1 AS ok FROM lessons WHERE id = ?").bind(id).first())) fail(404, "not_found", "找不到這個章節");
      const ext = (/\.([a-z0-9]{1,5})$/i.exec(String(body.fileName ?? ""))?.[1] ?? "audio").toLowerCase();
      const key = `audio/${id}/${crypto.randomUUID()}.${ext}`;
      const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: type } });
      await audit(ctx.db, admin.sub, "lesson.audio_upload_start", "lesson", id, key).run();
      return { key, uploadId: upload.uploadId };
    },
  ],
  [
    "PUT",
    /^\/admin\/lessons\/([\w-]+)\/audio\/part$/,
    async (ctx, [id]) => {
      await requireLessonManager(ctx, id);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "音檔儲存空間尚未啟用");
      const key = ctx.url.searchParams.get("key") ?? "";
      const uploadId = ctx.url.searchParams.get("uploadId") ?? "";
      const part = Number(ctx.url.searchParams.get("part"));
      if (!key.startsWith(`audio/${id}/`) || !uploadId || !Number.isInteger(part) || part < 1 || part > 10000) fail(400, "invalid_part", "上傳參數不正確");
      const uploaded = await bucket.resumeMultipartUpload(key, uploadId).uploadPart(part, await ctx.req.arrayBuffer());
      return { partNumber: uploaded.partNumber, etag: uploaded.etag };
    },
  ],
  [
    "POST",
    /^\/admin\/lessons\/([\w-]+)\/audio\/complete$/,
    async (ctx, [id]) => {
      const admin = await requireLessonManager(ctx, id);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "音檔儲存空間尚未啟用");
      const body = await readJson<{ key?: unknown; uploadId?: unknown; parts?: unknown; durationSeconds?: unknown }>(ctx.req);
      const key = typeof body.key === "string" ? body.key : "";
      if (!key.startsWith(`audio/${id}/`) || typeof body.uploadId !== "string" || !Array.isArray(body.parts) || !body.parts.length) fail(400, "invalid_upload", "上傳參數不正確");
      const parts = (body.parts as { partNumber: number; etag: string }[]).map((x) => ({ partNumber: Number(x.partNumber), etag: String(x.etag) }));
      await bucket.resumeMultipartUpload(key, body.uploadId as string).complete(parts);
      const old = await ctx.db.prepare("SELECT media_type, media_ref FROM lessons WHERE id = ?").bind(id).first<{ media_type: string; media_ref: string | null }>();
      const seconds = typeof body.durationSeconds === "number" && body.durationSeconds > 0 ? body.durationSeconds : null;
      await ctx.db.batch([
        ctx.db
          .prepare("UPDATE lessons SET media_type = 'audio', media_ref = ?, start_seconds = NULL, end_seconds = NULL, duration_minutes = COALESCE(?, duration_minutes) WHERE id = ?")
          .bind(key, seconds ? Math.max(1, Math.ceil(seconds / 60)) : null, id),
        audit(ctx.db, admin.sub, "lesson.audio_uploaded", "lesson", id, key),
      ]);
      if (old?.media_type === "audio" && old.media_ref && old.media_ref !== key) await bucket.delete(old.media_ref).catch(() => undefined);
      return { ok: true, key };
    },
  ],
  [
    "GET",
    /^\/admin\/sharer-names$/,
    async (ctx) => {
      // 分享者姓名打字建議：行動大學裡已經用過的分享者與主講人姓名（去重、用得多的在前）。日後講師名單（講師資料表）建好，改由那邊提供。
      const s = requireMember(ctx);
      if (s.role !== "admin" && !(await rightsOf(ctx)).any) return fail(403, "forbidden", "只有課程管理者可以使用");
      const q = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 30);
      const { results } = await ctx.db
        .prepare(
          "SELECT name, COUNT(*) AS n FROM (SELECT sharer AS name FROM lessons WHERE kind = 'chapter' AND is_speaker = 0 UNION ALL SELECT teacher AS name FROM courses) WHERE name <> '' AND instr(name, ?) > 0 GROUP BY name ORDER BY n DESC, name LIMIT 20",
        )
        .bind(q)
        .all<{ name: string; n: number }>();
      return results.map((r) => r.name);
    },
  ],
  [
    "GET",
    /^\/admin\/link-title$/,
    async (ctx) => {
      // 貼上教材連結時，由伺服器代為讀取網頁標題（瀏覽器直接讀會被網站的跨網域限制擋住）。只有管理者可用，避免被當成公開的網頁代理。
      const s = requireMember(ctx);
      if (s.role !== "admin" && !(await rightsOf(ctx)).any) return fail(403, "forbidden", "只有課程管理者可以使用");
      const u = parseHttpsUrl(ctx.url.searchParams.get("url"));
      if (!u) return fail(400, "invalid_url", "請輸入 https 開頭的有效網址");
      const type = classifyLink(u);
      return { type, title: await fetchLinkTitle(u), defaultTitle: LINK_DEFAULT_TITLE[type] };
    },
  ],
  [
    "POST",
    /^\/admin\/courses\/([\w-]+)\/materials$/,
    async (ctx, [courseId]) => {
      // 新增「其他教材」：只有外部連結與名稱（名稱空白＝自動抓取，抓不到用類型的預設名稱）。教材與連結一次建立。
      const admin = await requireCourseManager(ctx, courseId);
      const body = await readJson<{ url?: unknown; title?: unknown }>(ctx.req);
      const u = parseHttpsUrl(body.url);
      if (!u) return fail(400, "invalid_url", "請輸入 https 開頭的有效網址");
      const title = cleanTitle(body.title) || cleanTitle(await fetchLinkTitle(u)) || LINK_DEFAULT_TITLE[classifyLink(u)];
      const course = await ctx.db.prepare("SELECT c.is_list, (SELECT COALESCE(MAX(position), 0) FROM lessons WHERE course_id = c.id) AS maxpos FROM courses c WHERE c.id = ?").bind(courseId).first<{ maxpos: number; is_list: number }>();
      if (!course) return fail(404, "not_found", "找不到這門課程");
      const id = `${courseId}-${randomId(6)}`;
      // 素材清單貼 YouTube 影片：存成影片來源，在 App 內原地播放（計入學習進度）；其他連結照常開外部網頁。
      const yt = course.is_list === 1 ? youtubeId(u.toString()) : null;
      // 「完整版課程影片」永遠是教材的最後一列：新教材插在它前面，它往後挪一格。
      const full = await ctx.db.prepare("SELECT id, position FROM lessons WHERE course_id = ? AND is_full = 1").bind(courseId).first<{ id: string; position: number }>();
      const attId = crypto.randomUUID();
      await ctx.db.batch([
        ...(full ? [ctx.db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(course.maxpos + 1, full.id)] : []),
        ctx.db.prepare("INSERT INTO lessons (id, course_id, position, title, sharer, sharer_rank, sharer_title, duration_minutes, media_type, media_ref, event_date, auto_cover, kind) VALUES (?, ?, ?, ?, '', '', '', 0, ?, ?, NULL, 0, 'material')").bind(id, courseId, full ? full.position : course.maxpos + 1, title, yt ? "youtube" : "demo", yt),
        ...(yt ? [] : [ctx.db.prepare("INSERT INTO lesson_attachments (id, lesson_id, course_id, name, kind, link_url, att_type, created_by) VALUES (?, ?, ?, ?, 'link', ?, ?, ?)").bind(attId, id, courseId, title, u.toString(), classifyLink(u), admin.sub)]),
        audit(ctx.db, admin.sub, "material.create", "lesson", id, `${classifyLink(u)}:${title}`),
      ]);
      return courseDetail(ctx, courseId);
    },
  ],
  [
    "PUT",
    /^\/admin\/lessons\/([\w-]+)\/material$/,
    async (ctx, [id]) => {
      // 修改「其他教材」：名稱與外部連結（連結換了就取代舊的；舊教材的影音、音檔、附件設定不再編輯，保留在系統裡）。
      const admin = await requireLessonManager(ctx, id);
      const lesson = await ctx.db.prepare("SELECT l.course_id, l.kind, l.is_full, l.media_type, l.media_ref, c.is_list FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ?").bind(id).first<{ course_id: string; kind: string; is_full: number; media_type: string; media_ref: string | null; is_list: number }>();
      if (!lesson) return fail(404, "not_found", "找不到這個教材");
      if (lesson.kind !== "material" || lesson.is_full === 1) return fail(400, "not_link_material", "這一列不是外部連結教材");
      const body = await readJson<{ url?: unknown; title?: unknown }>(ctx.req);
      const u = parseHttpsUrl(body.url);
      if (!u) return fail(400, "invalid_url", "請輸入 https 開頭的有效網址");
      const title = cleanTitle(body.title) || cleanTitle(await fetchLinkTitle(u)) || LINK_DEFAULT_TITLE[classifyLink(u)];
      // 素材清單：YouTube 影片存成影片來源（App 內播放；同一支影片保留原本的分鐘數與區間），其他連結存成外部連結。
      const yt = lesson.is_list === 1 ? youtubeId(u.toString()) : null;
      const sameVideo = !!yt && lesson.media_type === "youtube" && lesson.media_ref === yt;
      await ctx.db.batch([
        ctx.db.prepare("UPDATE lessons SET title = ? WHERE id = ?").bind(title, id),
        ...(yt && !sameVideo ? [ctx.db.prepare("UPDATE lessons SET media_type = 'youtube', media_ref = ?, duration_minutes = 0, start_seconds = NULL, end_seconds = NULL WHERE id = ?").bind(yt, id)] : []),
        ...(!yt && lesson.is_list === 1 && lesson.media_type !== "demo" ? [ctx.db.prepare("UPDATE lessons SET media_type = 'demo', media_ref = NULL, duration_minutes = 0, start_seconds = NULL, end_seconds = NULL WHERE id = ?").bind(id)] : []),
        ctx.db.prepare("DELETE FROM lesson_attachments WHERE lesson_id = ? AND kind = 'link'").bind(id),
        ...(yt ? [] : [ctx.db.prepare("INSERT INTO lesson_attachments (id, lesson_id, course_id, name, kind, link_url, att_type, created_by) VALUES (?, ?, ?, ?, 'link', ?, ?, ?)").bind(crypto.randomUUID(), id, lesson.course_id, title, u.toString(), classifyLink(u), admin.sub)]),
        audit(ctx.db, admin.sub, "material.update", "lesson", id, `${classifyLink(u)}:${title}`),
      ]);
      return courseDetail(ctx, lesson.course_id);
    },
  ],
  [
    "GET",
    /^\/me\/central-profile$/,
    async (ctx) => {
      const s = requireMember(ctx);
      if (s.kind !== "central") return fail(400, "central_only", "只有中央會員可以使用");
      return (await centralProfileView(s.sub, s.token)) ?? fail(502, "central_unavailable", "會員中心暫時無法連線，請稍後再試");
    },
  ],
  [
    "PUT",
    /^\/me\/central-profile$/,
    async (ctx) => {
      const s = requireMember(ctx);
      if (s.kind !== "central") return fail(400, "central_only", "只有中央會員可以使用");
      const body = await readJson<{ changes?: unknown; key?: unknown; value?: unknown }>(ctx.req);
      type Change = { key: "legal_name" | "display_name" | "contact_email" | "education_system" | "education_center" | "rank"; value: string | null };
      const keys = ["legal_name", "display_name", "contact_email", "education_system", "education_center", "rank"] as const;
      const raw = Array.isArray(body.changes) ? body.changes : [{ key: body.key, value: body.value }];
      if (!raw.length || raw.length > 8) return fail(400, "invalid_request", "沒有要儲存的內容");
      const changes: Change[] = [];
      for (const r of raw as { key?: unknown; value?: unknown }[]) {
        const key = keys.find((k) => k === r?.key);
        if (!key) return fail(400, "invalid_field", "不能修改這個欄位");
        const v = typeof r.value === "string" ? r.value.trim().slice(0, key === "contact_email" ? 254 : 50) : r.value === null ? null : undefined;
        if (v === undefined) return fail(400, "invalid_value", "內容格式不正確");
        if (key === "contact_email" && v && !validEmail(v.toLowerCase())) return fail(400, "invalid_email", "Email 格式不正確");
        changes.push({ key, value: v === "" ? null : key === "contact_email" ? v!.toLowerCase() : v });
      }
      // 資料正本在會員中心：直接寫過去（不保存、不寫日誌）。除了獎銜（要先有系統與中心）以外同時送出，最後再送獎銜。
      const errors: string[] = [];
      let pending = false;
      const write = async (c: Change) => {
        if (c.key === "contact_email") {
          if (!(await saveContactEmail(s.sub, s.token, c.value))) errors.push("Email：會員中心暫時無法儲存");
          return;
        }
        const r = await centralWriteField(s.token, c.key, c.value);
        if (!r.ok) errors.push(r.message);
        else if (r.status === "pending") pending = true;
      };
      await Promise.all(changes.filter((c) => c.key !== "rank").map(write));
      const rank = changes.find((c) => c.key === "rank");
      if (rank) await write(rank);
      forgetMember(s.sub);
      // 把最新的欄位狀態一起回傳，畫面不用再多問一趟。
      const form = await centralProfileView(s.sub, s.token).catch(() => null);
      return { ok: errors.length === 0, errors, pending, form };
    },
  ],
  [
    "GET",
    /^\/me\/vocab$/,
    async (ctx) => {
      const s = requireMember(ctx);
      if (s.kind !== "central") return [];
      const pool = ctx.url.searchParams.get("pool");
      if (pool !== "education_system" && pool !== "education_center" && pool !== "job_title") return fail(400, "invalid_pool", "不支援這個詞庫");
      return centralSuggest(s.token, pool, ctx.url.searchParams.get("q") ?? "");
    },
  ],
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
    /^\/admin\/quotes$/,
    async (ctx) => {
      requireSuperAdmin(ctx);
      const { results } = await ctx.db.prepare("SELECT id, body AS text FROM quotes ORDER BY created_at DESC").all<{ id: string; text: string }>();
      return results;
    },
  ],
  [
    "POST",
    /^\/admin\/quotes$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const text = cleanAnnouncement((await readJson<{ text?: unknown }>(ctx.req)).text);
      if (!text) return fail(400, "text_required", "請輸入金句（120 字以內）");
      const id = crypto.randomUUID();
      await ctx.db.prepare("INSERT INTO quotes (id, body, created_by) VALUES (?, ?, ?)").bind(id, text, s.sub).run();
      return { id, text };
    },
  ],
  [
    "PATCH",
    /^\/admin\/quotes\/([\w-]+)$/,
    async (ctx, [id]) => {
      requireSuperAdmin(ctx);
      const text = cleanAnnouncement((await readJson<{ text?: unknown }>(ctx.req)).text);
      if (!text) return fail(400, "text_required", "請輸入金句（120 字以內）");
      const r = await ctx.db.prepare("UPDATE quotes SET body = ? WHERE id = ?").bind(text, id).run();
      if (r.meta?.changes === 0) return fail(404, "not_found", "找不到這則金句");
      return { id, text };
    },
  ],
  [
    "DELETE",
    /^\/admin\/quotes\/([\w-]+)$/,
    async (ctx, [id]) => {
      requireSuperAdmin(ctx);
      await ctx.db.prepare("DELETE FROM quotes WHERE id = ?").bind(id).run();
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/announcements$/,
    async (ctx) => {
      // 首頁跑馬燈：公開（未登入也看得到），只回啟用中的公告。
      const { results } = await ctx.db.prepare("SELECT id, body FROM announcements WHERE enabled = 1 ORDER BY position, created_at").all<{ id: string; body: string }>();
      return results.map((r): Announcement => ({ id: r.id, text: r.body, enabled: true }));
    },
  ],
  [
    "GET",
    /^\/admin\/announcements$/,
    async (ctx) => {
      requireAdmin(ctx);
      const { results } = await ctx.db.prepare("SELECT id, body, enabled FROM announcements ORDER BY position, created_at").all<{ id: string; body: string; enabled: number }>();
      return results.map((r): Announcement => ({ id: r.id, text: r.body, enabled: r.enabled === 1 }));
    },
  ],
  [
    "POST",
    /^\/admin\/announcements$/,
    async (ctx) => {
      const admin = requireAdmin(ctx);
      const body = await readJson<{ text?: unknown }>(ctx.req);
      const text = cleanAnnouncement(body.text);
      if (!text) return fail(400, "text_required", "請輸入公告內容（120 字以內）");
      const n = await ctx.db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS m FROM announcements").first<{ n: number; m: number }>();
      if ((n?.n ?? 0) >= 30) return fail(409, "too_many", "最多 30 則公告，請先刪除不用的");
      const id = crypto.randomUUID();
      await ctx.db.batch([
        ctx.db.prepare("INSERT INTO announcements (id, body, position, created_by) VALUES (?, ?, ?, ?)").bind(id, text, (n?.m ?? 0) + 1, admin.sub),
        audit(ctx.db, admin.sub, "announcement.add", "announcement", id),
      ]);
      return { id, text, enabled: true } satisfies Announcement;
    },
  ],
  [
    "POST",
    /^\/admin\/announcements\/order$/,
    async (ctx) => {
      const admin = requireAdmin(ctx);
      const body = await readJson<{ ids?: unknown }>(ctx.req);
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
      if (!ids.length || ids.length > 30) return fail(400, "invalid_request", "排序參數不正確");
      await ctx.db.batch([...ids.map((id, i) => ctx.db.prepare("UPDATE announcements SET position = ? WHERE id = ?").bind(i + 1, id)), audit(ctx.db, admin.sub, "announcement.reorder", "announcement", "all")]);
      return { ok: true };
    },
  ],
  [
    "PATCH",
    /^\/admin\/announcements\/([\w-]+)$/,
    async (ctx, [id]) => {
      const admin = requireAdmin(ctx);
      const body = await readJson<{ text?: unknown; enabled?: unknown }>(ctx.req);
      const sets: string[] = [];
      const args: unknown[] = [];
      if (body.text !== undefined) {
        const text = cleanAnnouncement(body.text);
        if (!text) return fail(400, "text_required", "請輸入公告內容（120 字以內）");
        sets.push("body = ?");
        args.push(text);
      }
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== "boolean") return fail(400, "invalid_request", "參數不正確");
        sets.push("enabled = ?");
        args.push(body.enabled ? 1 : 0);
      }
      if (!sets.length) return fail(400, "invalid_request", "沒有要修改的內容");
      const [res] = await ctx.db.batch([
        ctx.db.prepare(`UPDATE announcements SET ${sets.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).bind(...args, id),
        audit(ctx.db, admin.sub, "announcement.edit", "announcement", id),
      ]);
      if (res.meta?.changes === 0) return fail(404, "not_found", "找不到這則公告");
      return { ok: true };
    },
  ],
  [
    "DELETE",
    /^\/admin\/announcements\/([\w-]+)$/,
    async (ctx, [id]) => {
      const admin = requireAdmin(ctx);
      const [res] = await ctx.db.batch([ctx.db.prepare("DELETE FROM announcements WHERE id = ?").bind(id), audit(ctx.db, admin.sub, "announcement.delete", "announcement", id)]);
      if (res.meta?.changes === 0) return fail(404, "not_found", "找不到這則公告");
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/media\/pub$/,
    async (ctx) => {
      // 課程封面與 EDM 是公開圖片（課程列表本來就要顯示；EDM 開放下載）。只服務資料庫裡仍在使用的檔案。
      const key = ctx.url.searchParams.get("k") ?? "";
      const bucket = ctx.env.MEDIA;
      if (!bucket || !/^(edm|cover|series|center|lesson)\/[\w-]+\/[\w.-]+$/.test(key)) return new Response("Not found", { status: 404 });
      const used = await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE edm_key = ? OR cover_key = ? UNION SELECT 1 FROM series_art WHERE edm_key = ? OR cover_key = ? UNION SELECT 1 FROM center_art WHERE edm_key = ? OR cover_key = ? UNION SELECT 1 FROM lessons WHERE cover_key = ? OR poster_key = ?").bind(key, key, key, key, key, key, key, key).first();
      const obj = used ? await bucket.get(key) : null;
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, {
        headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
      });
    },
  ],
  [
    "PUT",
    /^\/admin\/courses\/([\w-]+)\/edm$/,
    async (ctx, [id]) => {
      const part = "edm" as const;
      const s = requireMember(ctx);
      await requireCourseArt(ctx, s, id);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      const max = 8 * 1024 * 1024;
      if (!data.byteLength || data.byteLength > max) fail(413, "invalid_size", `圖片大小需在 ${max / 1024 / 1024}MB 以內（上傳時會自動壓縮）`);
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const old = await ctx.db.prepare("SELECT edm_key AS k FROM courses WHERE id = ?").bind(id).first<{ k: string | null }>();
      const key = `${part}/${id}/${crypto.randomUUID()}.${img.ext}`;
      await bucket.put(key, data.buffer as ArrayBuffer, { httpMetadata: { contentType: img.type } });
      await ctx.db.batch([
        ctx.db.prepare("UPDATE courses SET edm_key = ?, cover_rect = NULL, art_version = art_version + 1 WHERE id = ?").bind(key, id),
        audit(ctx.db, s.sub, "course.edm_upload", "course", id, key),
      ]);
      if (old?.k) await bucket.delete(old.k).catch(() => undefined);
      return { ok: true, url: pubUrl(key, 0) };
    },
  ],
  [
    "DELETE",
    /^\/admin\/courses\/([\w-]+)\/edm$/,
    async (ctx, [id, _part]) => {
      const s = requireMember(ctx);
      await requireCourseArt(ctx, s, id);
      const old = await ctx.db.prepare("SELECT edm_key AS k FROM courses WHERE id = ?").bind(id).first<{ k: string | null }>();
      await ctx.db.batch([
        ctx.db.prepare("UPDATE courses SET edm_key = NULL, art_version = art_version + 1 WHERE id = ?").bind(id),
        audit(ctx.db, s.sub, "course.edm_remove", "course", id),
      ]);
      if (old?.k) await ctx.env.MEDIA?.delete(old.k).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "PUT",
    /^\/admin\/courses\/([\w-]+)\/cover$/,
    async (ctx, [id]) => {
      // 課程清單用的 16:9 封面：管理員在瀏覽器從 EDM 裁切、壓縮後上傳。
      const s = requireMember(ctx);
      await requireCourseArt(ctx, s, id);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      if (!data.byteLength || data.byteLength > 3 * 1024 * 1024) fail(413, "invalid_size", "封面大小需在 3MB 以內（上傳時會自動壓縮）");
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const old = await ctx.db.prepare("SELECT cover_key AS k FROM courses WHERE id = ?").bind(id).first<{ k: string | null }>();
      const key = `cover/${id}/${crypto.randomUUID()}.${img.ext}`;
      await bucket.put(key, data.buffer as ArrayBuffer, { httpMetadata: { contentType: img.type } });
      await ctx.db.batch([ctx.db.prepare("UPDATE courses SET cover_key = ?, art_version = art_version + 1 WHERE id = ?").bind(key, id), audit(ctx.db, s.sub, "course.cover_upload", "course", id, key)]);
      if (old?.k) await bucket.delete(old.k).catch(() => undefined);
      return { ok: true, url: pubUrl(key, 0) };
    },
  ],
  [
    "DELETE",
    /^\/admin\/courses\/([\w-]+)\/cover$/,
    async (ctx, [id]) => {
      const s = requireMember(ctx);
      await requireCourseArt(ctx, s, id);
      const old = await ctx.db.prepare("SELECT cover_key AS k FROM courses WHERE id = ?").bind(id).first<{ k: string | null }>();
      await ctx.db.batch([ctx.db.prepare("UPDATE courses SET cover_key = NULL, art_version = art_version + 1 WHERE id = ?").bind(id), audit(ctx.db, s.sub, "course.cover_remove", "course", id)]);
      if (old?.k) await ctx.env.MEDIA?.delete(old.k).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "PUT",
    /^\/admin\/lessons\/([\w-]+)\/art$/,
    async (ctx, [id]) => {
      // 章節封面（課程要先勾選「章節各自設定封面」）：part=cover（橫式 16:9）或 poster（直式）；圖片已在瀏覽器裁切、壓縮。
      const s = requireMember(ctx);
      const part = ctx.url.searchParams.get("part");
      if (part !== "cover" && part !== "poster") return fail(400, "invalid_part", "封面類型不正確");
      const lesson = await ctx.db.prepare("SELECT l.course_id, l.cover_key, l.poster_key, c.chapter_covers FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ?").bind(id).first<{ course_id: string; cover_key: string | null; poster_key: string | null; chapter_covers: number }>();
      if (!lesson) return fail(404, "not_found", "找不到這個章節");
      await requireCourseArt(ctx, s, lesson.course_id);
      if (lesson.chapter_covers !== 1) fail(409, "chapter_covers_off", "這門課程尚未勾選「章節各自設定封面」");
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      if (!data.byteLength || data.byteLength > 3 * 1024 * 1024) fail(413, "invalid_size", "封面大小需在 3MB 以內（上傳時會自動壓縮）");
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const key = `lesson/${id}/${crypto.randomUUID()}.${img.ext}`;
      await bucket.put(key, data.buffer as ArrayBuffer, { httpMetadata: { contentType: img.type } });
      const col = part === "cover" ? "cover_key" : "poster_key";
      const old = part === "cover" ? lesson.cover_key : lesson.poster_key;
      await ctx.db.batch([ctx.db.prepare(`UPDATE lessons SET ${col} = ?, art_version = art_version + 1 WHERE id = ?`).bind(key, id), audit(ctx.db, s.sub, `lesson.${part}_upload`, "lesson", id, key)]);
      if (old) await bucket.delete(old).catch(() => undefined);
      return { ok: true, url: pubUrl(key, 0) };
    },
  ],
  [
    "DELETE",
    /^\/admin\/lessons\/([\w-]+)\/art$/,
    async (ctx, [id]) => {
      const s = requireMember(ctx);
      const part = ctx.url.searchParams.get("part");
      if (part !== "cover" && part !== "poster") return fail(400, "invalid_part", "封面類型不正確");
      const lesson = await ctx.db.prepare("SELECT course_id, cover_key, poster_key FROM lessons WHERE id = ?").bind(id).first<{ course_id: string; cover_key: string | null; poster_key: string | null }>();
      if (!lesson) return fail(404, "not_found", "找不到這個章節");
      await requireCourseArt(ctx, s, lesson.course_id);
      const col = part === "cover" ? "cover_key" : "poster_key";
      const old = part === "cover" ? lesson.cover_key : lesson.poster_key;
      await ctx.db.batch([ctx.db.prepare(`UPDATE lessons SET ${col} = NULL, art_version = art_version + 1 WHERE id = ?`).bind(id), audit(ctx.db, s.sub, `lesson.${part}_remove`, "lesson", id)]);
      if (old) await ctx.env.MEDIA?.delete(old).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/admin\/lessons\/([\w-]+)\/mux-frame$/,
    async (ctx, [id]) => {
      // Mux 影片任一秒的截圖（簽名縮圖），讓管理員挑章節封面。只代理圖片，不回傳 Playback ID。
      await requireLessonManager(ctx, id);
      const l = await ctx.db.prepare("SELECT media_type, media_ref FROM lessons WHERE id = ?").bind(id).first<{ media_type: string; media_ref: string | null }>();
      if (!l || l.media_type !== "mux" || !l.media_ref) return fail(400, "not_mux", "這個章節不是 Mux 影片");
      const t = Number(ctx.url.searchParams.get("time"));
      if (!Number.isFinite(t) || t < 0 || t > 86400) return fail(400, "invalid_time", "時間不正確");
      const frame = await muxThumbnail(ctx.env, l.media_ref, t);
      if (!frame) return fail(502, "mux_frame_failed", "取得影片截圖失敗，請稍後再試");
      return new Response(frame.bytes, { headers: { "content-type": frame.type, "cache-control": "no-store" } });
    },
  ],
  [
    "GET",
    /^\/media\/audio$/,
    async (ctx) => {
      // 以短效簽名網址授權（播放器無法帶 Authorization 標頭），支援 Range 以便拖曳進度。
      const key = await verifyAudioUrl(ctx.env, ctx.url);
      const bucket = ctx.env.MEDIA;
      if (!key || !bucket) return new Response("Forbidden", { status: 403 });
      const range = /^bytes=(\d*)-(\d*)$/.exec(ctx.req.headers.get("range") ?? "");
      const head = await bucket.head(key);
      if (!head) return new Response("Not found", { status: 404 });
      const size = head.size;
      let start = 0;
      let end = size - 1;
      if (range && (range[1] || range[2])) {
        start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
      }
      const obj = await bucket.get(key, { range: { offset: start, length: end - start + 1 } });
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = new Headers({
        "content-type": head.httpMetadata?.contentType ?? "audio/mpeg",
        "accept-ranges": "bytes",
        "content-length": String(end - start + 1),
        "cache-control": "private, max-age=3600",
      });
      if (range && (range[1] || range[2])) headers.set("content-range", `bytes ${start}-${end}/${size}`);
      return new Response(obj.body, { status: range && (range[1] || range[2]) ? 206 : 200, headers });
    },
  ],
  [
    "GET",
    /^\/admin\/mux\/assets$/,
    async (ctx) => {
      requireSuperAdmin(ctx);
      const cursor = ctx.url.searchParams.get("cursor") ?? undefined;
      if (cursor && !/^[\w-]{1,200}$/.test(cursor)) fail(400, "invalid_cursor", "分頁參數不正確");
      try {
        return await listMuxAssets(ctx.env, cursor);
      } catch (e) {
        if (!(e instanceof MuxApiError)) throw e;
        if (e.code === "mux_api_not_configured") return fail(503, e.code, "尚未設定 Mux API 存取權杖，無法讀取影片清單");
        if (e.code === "mux_api_unauthorized") return fail(503, e.code, "Mux API 存取權杖無效或權限不足");
        return fail(503, e.code, "Mux 暫時無法連線，請稍後再試");
      }
    },
  ],
  // ---------- 小編（各中心的課程編輯人員，只存在行動大學） ----------
  ["GET", /^\/admin\/editors$/, async (ctx) => listEditors(ctx)],
  [
    "GET",
    /^\/admin\/editors\/candidates$/,
    async (ctx) => {
      const s = requireMember(ctx);
      const rights = await rightsOf(ctx);
      const center = await editorCenter(ctx, rights, ctx.url.searchParams.get("center"));
      const q = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 30);
      const taken = new Set((await ctx.db.prepare("SELECT member_sub FROM course_editors WHERE center_key = ?").bind(center.key).all<{ member_sub: string }>()).results.map((r) => r.member_sub));
      if (s.kind !== "central") {
        // 本機測試：用模擬會員代替會員中心的名單。
        const list = DEMO_MEMBERS.filter((d) => d.center && centerKey(d.center) === center.key && d.sub !== s.sub && (!q || d.name.includes(q)));
        return { center: center.label, members: list.map((d): EditorCandidate => ({ memberId: d.sub, name: d.name, avatarUrl: null, signedIn: true, already: taken.has(d.sub) })), next: null };
      }
      try {
        const page = await centerMembers(s.token, { q, cursor: ctx.url.searchParams.get("cursor"), center: rights.admin ? center.label : null, limit: 30 });
        return { center: page.center?.label ?? center.label, members: page.members.map((m): EditorCandidate => ({ ...m, already: taken.has(m.memberId) })), next: page.next };
      } catch (e) {
        const err = e as { status?: number; code?: string };
        if (err.code === "field_not_allowed") fail(503, "central_field_not_allowed", "會員中心尚未開放「顯示名稱」給行動大學：請超級管理員到會員中心後台「平台設定」勾選 display_name");
        if (err.status === 403) fail(403, "central_forbidden", "會員中心不允許查詢這個中心的名單（需要該中心已審核的音控或會長職務）");
        if (err.status === 404) fail(404, "unknown_center", "會員中心找不到這個中心");
        if (err.status === 422) fail(400, "center_required", "請先選擇中心");
        return fail(503, "central_unavailable", "暫時無法取得會員中心的名單，請稍後再試");
      }
    },
  ],
  [
    "POST",
    /^\/admin\/editors$/,
    async (ctx) => {
      const s = requireMember(ctx);
      const rights = await rightsOf(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const center = await editorCenter(ctx, rights, typeof body.center === "string" ? body.center : null);
      const sub = typeof body.memberId === "string" ? body.memberId.trim() : "";
      if (!/^[\w-]{3,128}$/.test(sub)) fail(400, "invalid_member", "請從名單選擇會員");
      if (sub === s.sub) fail(400, "invalid_member", "不能指派自己");
      const name = text(body.name, 60) ?? "";
      const flags = editorFlags(body, { create: true, editOthers: false, deleteOthers: false });
      const existed = await ctx.db.prepare("SELECT 1 AS ok FROM course_editors WHERE center_key = ? AND member_sub = ?").bind(center.key, sub).first();
      if (existed) fail(409, "already_editor", "這位會員已經是這個中心的小編");
      await ctx.db.batch([
        ctx.db
          .prepare("INSERT INTO course_editors (center_key, center_label, member_sub, member_name, can_create, can_edit_others, can_delete_others, added_by_sub) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(center.key, center.label, sub, name, flags.create ? 1 : 0, flags.editOthers ? 1 : 0, flags.deleteOthers ? 1 : 0, s.sub),
        notify(ctx.db, { sub }, `您已被指派為「${center.label}」的小編`, `${s.name || "管理者"}指派您協助編輯${center.label}的課程與章節。權限：${editorFlagText(flags)}。登入寰宇行動大學後，在課程介紹頁上方按「編輯」即可開始。`, "/courses"),
        audit(ctx.db, s.sub, "editor.add", "course_editor", sub, `${center.label}:${editorFlagText(flags)}`),
      ]);
      return listEditors(ctx, center);
    },
  ],
  [
    "PATCH",
    /^\/admin\/editors\/([\w-]+)$/,
    async (ctx, [sub]) => {
      const s = requireMember(ctx);
      const rights = await rightsOf(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const center = await editorCenter(ctx, rights, typeof body.center === "string" ? body.center : null);
      const cur = await ctx.db.prepare("SELECT can_create, can_edit_others, can_delete_others FROM course_editors WHERE center_key = ? AND member_sub = ?").bind(center.key, sub).first<{ can_create: number; can_edit_others: number; can_delete_others: number }>();
      if (!cur) return fail(404, "not_found", "找不到這位小編");
      const flags = editorFlags(body, { create: cur.can_create === 1, editOthers: cur.can_edit_others === 1, deleteOthers: cur.can_delete_others === 1 });
      await ctx.db.batch([
        ctx.db.prepare("UPDATE course_editors SET can_create = ?, can_edit_others = ?, can_delete_others = ?, updated_at = ? WHERE center_key = ? AND member_sub = ?").bind(flags.create ? 1 : 0, flags.editOthers ? 1 : 0, flags.deleteOthers ? 1 : 0, iso(), center.key, sub),
        audit(ctx.db, s.sub, "editor.update", "course_editor", sub!, `${center.label}:${editorFlagText(flags)}`),
      ]);
      return listEditors(ctx, center);
    },
  ],
  [
    "DELETE",
    /^\/admin\/editors\/([\w-]+)$/,
    async (ctx, [sub]) => {
      const s = requireMember(ctx);
      const rights = await rightsOf(ctx);
      const center = await editorCenter(ctx, rights, ctx.url.searchParams.get("center"));
      const [res] = await ctx.db.batch([
        ctx.db.prepare("DELETE FROM course_editors WHERE center_key = ? AND member_sub = ?").bind(center.key, sub),
        audit(ctx.db, s.sub, "editor.remove", "course_editor", sub!, center.label),
      ]);
      if (res.meta?.changes === 0) fail(404, "not_found", "找不到這位小編");
      await ctx.db.batch([notify(ctx.db, { sub: sub! }, `您已不是「${center.label}」的小編`, `${s.name || "管理者"}取消了您在${center.label}的小編身分；之前的課程仍保留。`, "/courses")]);
      return listEditors(ctx, center);
    },
  ],
  // ---------- 中心 EDM（全部課程頁選了中心才顯示） ----------
  [
    "GET",
    /^\/center-art$/,
    async (ctx): Promise<CenterArt[]> => {
      const { results } = await ctx.db
        .prepare("SELECT center_key, center_label, edm_key, art_version, cover_key, cover_rect, edm_view_y FROM center_art ORDER BY center_label")
        .all<{ center_key: string; center_label: string; edm_key: string; art_version: number; cover_key: string | null; cover_rect: string | null; edm_view_y: number }>();
      return results.map((r) => ({
        centerKey: r.center_key,
        center: r.center_label,
        edmUrl: pubUrl(r.edm_key, r.art_version),
        coverUrl: r.cover_key ? pubUrl(r.cover_key, r.art_version) : null,
        coverRect: parseCoverRect(r.cover_rect),
        edmViewY: r.edm_view_y,
      }));
    },
  ],
  [
    "PUT",
    /^\/admin\/center-art$/,
    async (ctx) => {
      const { s, center } = await requireCenterArt(ctx, ctx.url.searchParams.get("center"));
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      const max = 8 * 1024 * 1024;
      if (!data.byteLength || data.byteLength > max) fail(413, "invalid_size", `圖片大小需在 ${max / 1024 / 1024}MB 以內（上傳時會自動壓縮）`);
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const old = await ctx.db.prepare("SELECT edm_key AS k FROM center_art WHERE center_key = ?").bind(center.key).first<{ k: string }>();
      const key = `center/${crypto.randomUUID().slice(0, 8)}/${crypto.randomUUID()}.${img.ext}`;
      await bucket.put(key, data.buffer as ArrayBuffer, { httpMetadata: { contentType: img.type } });
      await ctx.db.batch([
        ctx.db
          .prepare("INSERT INTO center_art (center_key, center_label, edm_key) VALUES (?, ?, ?) ON CONFLICT(center_key) DO UPDATE SET edm_key = excluded.edm_key, center_label = excluded.center_label, cover_rect = NULL, edm_view_y = 0, art_version = art_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
          .bind(center.key, center.label, key),
        audit(ctx.db, s.sub, "center.edm_upload", "center", center.key, key),
      ]);
      if (old?.k) await bucket.delete(old.k).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/center-info$/,
    async (ctx): Promise<Record<string, string>> => {
      // 各教育中心的地址（沒有設定的中心不在裡面）。登入會員都能讀。
      requireMember(ctx);
      const { results } = await ctx.db.prepare("SELECT center_key, address FROM center_info WHERE address <> ''").all<{ center_key: string; address: string }>();
      return Object.fromEntries(results.map((r) => [r.center_key, r.address]));
    },
  ],
  [
    "PUT",
    /^\/admin\/center-info$/,
    async (ctx) => {
      // 設定教育中心的地址（權限同中心 EDM）。空白＝清除。
      const { s, center } = await requireCenterArt(ctx, ctx.url.searchParams.get("center"));
      const body = await readJson<{ address?: unknown }>(ctx.req);
      const address = typeof body.address === "string" ? body.address.trim().slice(0, 120) : "";
      if (!address) {
        await ctx.db.batch([ctx.db.prepare("DELETE FROM center_info WHERE center_key = ?").bind(center.key), audit(ctx.db, s.sub, "center.address_clear", "center", center.key)]);
      } else {
        await ctx.db.batch([
          ctx.db
            .prepare("INSERT INTO center_info (center_key, center_label, address) VALUES (?, ?, ?) ON CONFLICT(center_key) DO UPDATE SET address = excluded.address, center_label = excluded.center_label, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
            .bind(center.key, center.label, address),
          audit(ctx.db, s.sub, "center.address_set", "center", center.key, address),
        ]);
      }
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/center-names$/,
    async (ctx): Promise<Record<string, string>> => {
      // 教育中心的自訂顯示名稱（沒有設定的中心不在裡面，前端用預設格式）。登入會員都能讀。
      requireMember(ctx);
      const { results } = await ctx.db.prepare("SELECT center_key, display_name FROM center_names").all<{ center_key: string; display_name: string }>();
      return Object.fromEntries(results.map((r) => [r.center_key, r.display_name]));
    },
  ],
  [
    "PUT",
    /^\/admin\/center-name$/,
    async (ctx) => {
      // 自訂教育中心的顯示名稱（權限同中心 EDM）。空白＝還原預設。整個行動大學顯示中心名稱的地方都會跟著變。
      const { s, center } = await requireCenterArt(ctx, ctx.url.searchParams.get("center"));
      const body = await readJson<{ name?: unknown }>(ctx.req);
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 30) : "";
      if (!name) {
        await ctx.db.batch([ctx.db.prepare("DELETE FROM center_names WHERE center_key = ?").bind(center.key), audit(ctx.db, s.sub, "center.name_reset", "center", center.key)]);
      } else {
        await ctx.db.batch([
          ctx.db
            .prepare("INSERT INTO center_names (center_key, center_label, display_name) VALUES (?, ?, ?) ON CONFLICT(center_key) DO UPDATE SET display_name = excluded.display_name, center_label = excluded.center_label, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
            .bind(center.key, center.label, name),
          audit(ctx.db, s.sub, "center.name_set", "center", center.key, name),
        ]);
      }
      return { ok: true };
    },
  ],
  [
    "PUT",
    /^\/admin\/center-art\/cover$/,
    async (ctx) => {
      // 中心卡用的 16:9 封面：管理者在瀏覽器從中心 EDM 裁切、壓縮後上傳（先要有中心 EDM）。
      const { s, center } = await requireCenterArt(ctx, ctx.url.searchParams.get("center"));
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const old = await ctx.db.prepare("SELECT cover_key AS k FROM center_art WHERE center_key = ?").bind(center.key).first<{ k: string | null }>();
      if (!old) fail(409, "no_edm", "請先上傳中心 EDM");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      if (!data.byteLength || data.byteLength > 3 * 1024 * 1024) fail(413, "invalid_size", "封面大小需在 3MB 以內（上傳時會自動壓縮）");
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const key = `center/${crypto.randomUUID().slice(0, 8)}/cover-${crypto.randomUUID()}.${img.ext}`;
      await bucket.put(key, data.buffer as ArrayBuffer, { httpMetadata: { contentType: img.type } });
      await ctx.db.batch([
        ctx.db.prepare("UPDATE center_art SET cover_key = ?, art_version = art_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE center_key = ?").bind(key, center.key),
        audit(ctx.db, s.sub, "center.cover_upload", "center", center.key, key),
      ]);
      if (old?.k) await bucket.delete(old.k).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "PATCH",
    /^\/admin\/center-art$/,
    async (ctx) => {
      // 封面框（占 EDM 寬高的比例）與預設停留位置永遠同步：預設位置＝封面框上緣。
      const { s, center } = await requireCenterArt(ctx, ctx.url.searchParams.get("center"));
      const body = await readJson<{ coverRect?: unknown }>(ctx.req);
      const r = body.coverRect as Partial<CoverRect> | null | undefined;
      const ok = !!r && [r.x, r.y, r.w].every((n) => typeof n === "number" && Number.isFinite(n)) && r.w! > 0 && r.w! <= 1 && r.x! >= 0 && r.x! + r.w! <= 1.0001 && r.y! >= 0 && r.y! <= 1;
      if (!ok) fail(400, "invalid_cover_rect", "封面裁切範圍不正確");
      const rect = { x: Math.round(r!.x! * 10000) / 10000, y: Math.round(r!.y! * 10000) / 10000, w: Math.round(r!.w! * 10000) / 10000 };
      const res = await ctx.db.prepare("UPDATE center_art SET cover_rect = ?, edm_view_y = ?, art_version = art_version + 1 WHERE center_key = ?").bind(JSON.stringify(rect), rect.y, center.key).run();
      if (!res.meta?.changes) fail(409, "no_edm", "請先上傳中心 EDM");
      await ctx.db.batch([audit(ctx.db, s.sub, "center.cover_rect", "center", center.key, JSON.stringify(rect))]);
      return { ok: true };
    },
  ],
  [
    "DELETE",
    /^\/admin\/center-art$/,
    async (ctx) => {
      const { s, center } = await requireCenterArt(ctx, ctx.url.searchParams.get("center"));
      const old = await ctx.db.prepare("SELECT edm_key AS k, cover_key AS c FROM center_art WHERE center_key = ?").bind(center.key).first<{ k: string; c: string | null }>();
      await ctx.db.batch([ctx.db.prepare("DELETE FROM center_art WHERE center_key = ?").bind(center.key), audit(ctx.db, s.sub, "center.edm_remove", "center", center.key)]);
      if (old?.k) await ctx.env.MEDIA?.delete(old.k).catch(() => undefined);
      if (old?.c) await ctx.env.MEDIA?.delete(old.c).catch(() => undefined);
      return { ok: true };
    },
  ],
  ["GET", /^\/admin\/courses$/, async (ctx) => listCourses(ctx, true)],
  ["POST", /^\/admin\/courses$/, async (ctx) => createCourse(ctx, await requireCourseCreator(ctx))],
  [
    "GET",
    /^\/admin\/(categories|series|locations)$/,
    async (ctx, [what]) => {
      const who = await requireCourseStaff(ctx);
      const kind = what === "categories" ? "category" : what === "series" ? "series" : "location";
      return keywordChoices(ctx, kind, who.role !== "admin" ? (who.center?.key ?? "") : null);
    },
  ],
  ["GET", /^\/admin\/ai-models$/, async (ctx) => (requireSuperAdmin(ctx), aiModelsView(ctx))],
  [
    "PUT",
    /^\/admin\/ai-models$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const cur = await loadSettings(ctx.db);
      const st = normalizeSettings({ ...cur, ...(body.settings as object) }, cur);
      const sel = normalizeSelection({ ...(await loadSelection(ctx.db)), ...(body.selection as object) });
      // 只用免費額度時，不能選沒有免費額度的外部模型
      const paid = AI_MODELS.find((m) => m.needsKey && Object.values(sel).includes(m.id));
      if (st.freeOnly && paid) fail(409, "free_only", `目前設定為「只用免費模型」，「${paid.name}」沒有免費額度，請先關閉「只用免費模型」`);
      await saveSelection(ctx.db, sel);
      await saveSettings(ctx.db, st);
      await audit(ctx.db, s.sub, "ai_models.set", "ui_settings", "ai_models", JSON.stringify({ sel, st })).run();
      return aiModelsView(ctx);
    },
  ],
  [
    "POST",
    /^\/admin\/ai-models\/test$/,
    async (ctx) => {
      requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      try {
        return { ok: true, message: await testConnection(ctx.env, ctx.db, String(body.target ?? "")), view: await aiModelsView(ctx) };
      } catch (e) {
        if (e instanceof AiStopped) fail(429, "ai_stopped", e.message);
        fail(502, "ai_test_failed", (e as Error).message);
      }
    },
  ],
  ["GET", /^\/admin\/lessons\/([\w-]+)\/transcript$/, async (ctx, [id]) => (await requireLessonManager(ctx, id!), transcriptView(ctx.db, id!))],
  [
    "POST",
    /^\/admin\/lessons\/([\w-]+)\/transcript\/next$/,
    async (ctx, [id]) => {
      // 轉下一段逐字稿（前端依序呼叫直到完成）。額度用完回 429，隔天可接著做。
      const admin = await requireLessonManager(ctx, id!);
      const body = await readJson<Record<string, unknown>>(ctx.req).catch(() => ({}) as Record<string, unknown>);
      try {
        const view = await transcribeNext(ctx.env, ctx.db, id!, { restart: body.restart === true });
        if (body.restart === true) await audit(ctx.db, admin.sub, "lesson.transcript_restart", "lesson", id!).run();
        return view;
      } catch (e) {
        if (e instanceof AiStopped) fail(429, "ai_stopped", e.message);
        if (e instanceof TranscribeError) fail(e.code === "not_found" ? 404 : e.code === "ai_failed" ? 502 : 409, e.code, e.message);
        throw e;
      }
    },
  ],
  ["GET", /^\/admin\/short-links$/, async (ctx) => (requireSuperAdmin(ctx), listShortLinks(ctx))],
  [
    "POST",
    /^\/admin\/course-urls\/backfill$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const n = await backfillCourseUrls(ctx);
      await audit(ctx.db, s.sub, "course_url.backfill", "course", "all", String(n)).run();
      return { total: n };
    },
  ],
  [
    "PUT",
    /^\/admin\/short-links$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const kind = body.kind === "center" ? "center" : keywordKind(body.kind);
      if (kind === "location") fail(400, "invalid_kind", "只有分類、系列與中心可以設定短網址");
      const value = keywordText(body.value);
      if (kind === "center") await assertCentralCenters(ctx, [value]);
      const slug = typeof body.slug === "string" ? body.slug.trim() : ""; // 照輸入的大小寫保存與顯示；比對時不分大小寫
      if (RESERVED_SLUGS.has(slug.toLowerCase())) fail(400, "reserved_slug", `「${slug}」是網站頁面名稱，請換一個縮寫`);
      if (!SLUG_RE.test(slug)) fail(400, "invalid_slug", "縮寫只能用英文字母（大小寫都可以）、數字與連字號（-），長度 2～30 字");
      const taken = await ctx.db.prepare("SELECT kind, value FROM short_links WHERE slug = ? COLLATE NOCASE").bind(slug).first<{ kind: string; value: string }>();
      if (taken && !(taken.kind === kind && taken.value === value)) fail(409, "slug_taken", `「${slug}」已被「${taken.value}」使用`);
      await ctx.db.batch([
        ctx.db.prepare("DELETE FROM short_links WHERE kind = ? AND value = ?").bind(kind, value),
        ctx.db.prepare("INSERT INTO short_links (slug, kind, value) VALUES (?, ?, ?)").bind(slug, kind, value),
        audit(ctx.db, s.sub, "short_link.set", "short_link", kind, `${value} → ${slug}`),
      ]);
      // 中心縮寫設定好了：補上這個中心還沒有專屬網址的課程。
      if (kind === "center") await backfillCourseUrls(ctx, centerKey(value));
      return listShortLinks(ctx);
    },
  ],
  [
    "POST",
    /^\/admin\/short-links\/remove$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const kind = body.kind === "center" ? "center" : keywordKind(body.kind);
      const value = keywordText(body.value);
      await ctx.db.batch([ctx.db.prepare("DELETE FROM short_links WHERE kind = ? AND value = ?").bind(kind, value), audit(ctx.db, s.sub, "short_link.remove", "short_link", kind, value)]);
      return listShortLinks(ctx);
    },
  ],
  [
    "GET",
    /^\/admin\/central-options$/,
    async (ctx) => {
      const s = await requireCourseStaff(ctx);
      // 獎銜選單與會員中心相同（正本）；測試帳號用本地階梯。
      if (s.kind === "central") {
        const list = await rankOptionList(s.token);
        if (list.length) return { ranks: list.filter((o) => o.value !== "none") };
      }
      return { ranks: [...(await ranks(ctx.db)).values()].filter((r) => r.code !== "none").map((r) => ({ value: r.code, label: r.name })) };
    },
  ],
  ["GET", /^\/admin\/keywords$/, async (ctx) => (requireSuperAdmin(ctx), listKeywords(ctx))],
  [
    "POST",
    /^\/admin\/keywords$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const kind = keywordKind(body.kind);
      const value = keywordText(body.value);
      await ctx.db.batch([ctx.db.prepare("INSERT OR IGNORE INTO keywords (kind, value) VALUES (?, ?)").bind(kind, value), audit(ctx.db, s.sub, "keyword.add", "keyword", kind, value)]);
      return listKeywords(ctx);
    },
  ],
  [
    "PATCH",
    /^\/admin\/keywords$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const kind = keywordKind(body.kind);
      const from = keywordText(body.from);
      const to = keywordText(body.to);
      const col = KEYWORD_COLUMN[kind];
      const catUpdates = kind === "category" ? await rewriteCategories(ctx, (list) => joinCats([...new Set(list.map((x) => (x === from ? to : x)))])) : [];
      await ctx.db.batch([
        ...(kind === "category" ? catUpdates : [ctx.db.prepare(`UPDATE courses SET ${col} = ? WHERE ${col} = ?`).bind(to, from)]),
        ctx.db.prepare("DELETE FROM keywords WHERE kind = ? AND value = ?").bind(kind, from),
        ctx.db.prepare("INSERT OR IGNORE INTO keywords (kind, value) VALUES (?, ?)").bind(kind, to),
        ...(kind === "category" || kind === "series" ? [ctx.db.prepare("UPDATE OR REPLACE short_links SET value = ? WHERE kind = ? AND value = ?").bind(to, kind, from)] : []),
        ...(kind === "series" ? [ctx.db.prepare("UPDATE OR REPLACE series_art SET series = ? WHERE series = ?").bind(to, from), ctx.db.prepare("UPDATE OR REPLACE page_views SET key = ? WHERE kind = 'series' AND key = ?").bind(to, from)] : []),
        audit(ctx.db, s.sub, "keyword.rename", "keyword", kind, `${from} → ${to}`),
      ]);
      return listKeywords(ctx);
    },
  ],
  [
    "POST",
    /^\/admin\/keywords\/remove$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const kind = keywordKind(body.kind);
      const value = keywordText(body.value);
      const col = KEYWORD_COLUMN[kind];
      const catUpdates = kind === "category" ? await rewriteCategories(ctx, (list) => joinCats(list.filter((x) => x !== value))) : [];
      const artRow = kind === "series" ? await ctx.db.prepare("SELECT edm_key AS k, cover_key AS c FROM series_art WHERE series = ?").bind(value).first<{ k: string; c: string | null }>() : null;
      const artKey = artRow?.k;
      if (artRow?.c) await ctx.env.MEDIA?.delete(artRow.c).catch(() => undefined);
      if (kind === "series") await ctx.db.prepare("DELETE FROM series_art WHERE series = ?").bind(value).run();
      if (artKey) await ctx.env.MEDIA?.delete(artKey).catch(() => undefined);
      await ctx.db.batch([
        ...(kind === "category" ? catUpdates : [ctx.db.prepare(`UPDATE courses SET ${col} = '' WHERE ${col} = ?`).bind(value)]),
        ctx.db.prepare("DELETE FROM keywords WHERE kind = ? AND value = ?").bind(kind, value),
        ctx.db.prepare("DELETE FROM short_links WHERE kind = ? AND value = ?").bind(kind, value),
        audit(ctx.db, s.sub, "keyword.remove", "keyword", kind, value),
      ]);
      return listKeywords(ctx);
    },
  ],
  [
    "PUT",
    /^\/admin\/series\/edm$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const series = keywordText(ctx.url.searchParams.get("series"));
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      const max = 8 * 1024 * 1024;
      if (!data.byteLength || data.byteLength > max) fail(413, "invalid_size", `圖片大小需在 ${max / 1024 / 1024}MB 以內（上傳時會自動壓縮）`);
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const old = await ctx.db.prepare("SELECT edm_key AS k FROM series_art WHERE series = ?").bind(series).first<{ k: string }>();
      const key = `series/${crypto.randomUUID().slice(0, 8)}/${crypto.randomUUID()}.${img.ext}`;
      await bucket.put(key, data.buffer as ArrayBuffer, { httpMetadata: { contentType: img.type } });
      await ctx.db.batch([
        ctx.db
          .prepare("INSERT INTO series_art (series, edm_key) VALUES (?, ?) ON CONFLICT(series) DO UPDATE SET edm_key = excluded.edm_key, art_version = art_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
          .bind(series, key),
        ctx.db.prepare("INSERT OR IGNORE INTO keywords (kind, value) VALUES ('series', ?)").bind(series),
        audit(ctx.db, s.sub, "series.edm_upload", "series", series, key),
      ]);
      if (old?.k) await bucket.delete(old.k).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/series-art$/,
    async (ctx): Promise<SeriesArt[]> => {
      const { results } = await ctx.db
        .prepare("SELECT series, edm_key, art_version, cover_key, cover_rect, edm_view_y FROM series_art ORDER BY series")
        .all<{ series: string; edm_key: string; art_version: number; cover_key: string | null; cover_rect: string | null; edm_view_y: number }>();
      return results.map((r) => ({
        series: r.series,
        edmUrl: pubUrl(r.edm_key, r.art_version),
        coverUrl: r.cover_key ? pubUrl(r.cover_key, r.art_version) : null,
        coverRect: parseCoverRect(r.cover_rect),
        edmViewY: r.edm_view_y,
      }));
    },
  ],
  [
    "PUT",
    /^\/admin\/series\/cover$/,
    async (ctx) => {
      // 系列頁用的 16:9 封面：與中心完全相同的做法（管理者在瀏覽器從 EDM 裁切、壓縮後上傳，先要有系列 EDM）。
      const s = requireSuperAdmin(ctx);
      const series = keywordText(ctx.url.searchParams.get("series"));
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const old = await ctx.db.prepare("SELECT cover_key AS k FROM series_art WHERE series = ?").bind(series).first<{ k: string | null }>();
      if (!old) fail(409, "no_edm", "請先上傳系列 EDM");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      if (!data.byteLength || data.byteLength > 3 * 1024 * 1024) fail(413, "invalid_size", "封面大小需在 3MB 以內（上傳時會自動壓縮）");
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const key = `series/${crypto.randomUUID().slice(0, 8)}/cover-${crypto.randomUUID()}.${img.ext}`;
      await bucket.put(key, data.buffer as ArrayBuffer, { httpMetadata: { contentType: img.type } });
      await ctx.db.batch([
        ctx.db.prepare("UPDATE series_art SET cover_key = ?, art_version = art_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE series = ?").bind(key, series),
        audit(ctx.db, s.sub, "series.cover_upload", "series", series, key),
      ]);
      if (old?.k) await bucket.delete(old.k).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "PATCH",
    /^\/admin\/series\/edm$/,
    async (ctx) => {
      // 封面框（占 EDM 寬高的比例）與預設停留位置永遠同步：預設位置＝封面框上緣。
      const s = requireSuperAdmin(ctx);
      const series = keywordText(ctx.url.searchParams.get("series"));
      const body = await readJson<{ coverRect?: unknown }>(ctx.req);
      const r = body.coverRect as Partial<CoverRect> | null | undefined;
      const ok = !!r && [r.x, r.y, r.w].every((n) => typeof n === "number" && Number.isFinite(n)) && r.w! > 0 && r.w! <= 1 && r.x! >= 0 && r.x! + r.w! <= 1.0001 && r.y! >= 0 && r.y! <= 1;
      if (!ok) fail(400, "invalid_cover_rect", "封面裁切範圍不正確");
      const rect = { x: Math.round(r!.x! * 10000) / 10000, y: Math.round(r!.y! * 10000) / 10000, w: Math.round(r!.w! * 10000) / 10000 };
      const res = await ctx.db.prepare("UPDATE series_art SET cover_rect = ?, edm_view_y = ?, art_version = art_version + 1 WHERE series = ?").bind(JSON.stringify(rect), rect.y, series).run();
      if (!res.meta?.changes) fail(409, "no_edm", "請先上傳系列 EDM");
      await ctx.db.batch([audit(ctx.db, s.sub, "series.cover_rect", "series", series, JSON.stringify(rect))]);
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/admin\/courses\/([\w-]+)\/review-desk$/,
    async (ctx, [id]) => {
      await requireCourseManager(ctx, id);
      return reviewDesk(ctx, id);
    },
  ],
  [
    "PUT",
    /^\/admin\/courses\/([\w-]+)\/review-roles$/,
    async (ctx, [id]) => {
      // 指定身份：主辦中心的會長／音控／小編也可以審核這門課（總部主辦的課＝各中心的該身份審核自己中心學員的報名）。
      const s = await requireCourseManager(ctx, id);
      const body = await readJson<{ roles?: unknown }>(ctx.req);
      const roles = Array.isArray(body.roles) ? [...new Set(body.roles.filter((r): r is ReviewRole => typeof r === "string" && (REVIEW_ROLES as readonly string[]).includes(r)))] : fail(400, "invalid_roles", "身份格式不正確");
      await ctx.db.batch([ctx.db.prepare("UPDATE courses SET review_roles = ? WHERE id = ?").bind(roles.join(","), id), audit(ctx.db, s.sub, "course.review_roles", "course", id, roles.join(","))]);
      return reviewDesk(ctx, id);
    },
  ],
  [
    "DELETE",
    /^\/admin\/courses\/([\w-]+)\/reviewers\/([\w:.@|-]+)$/,
    async (ctx, [id, sub]) => {
      const s = await requireCourseManager(ctx, id);
      await ctx.db.batch([ctx.db.prepare("DELETE FROM course_reviewers WHERE course_id = ? AND member_sub = ?").bind(id, sub), audit(ctx.db, s.sub, "course.reviewer_remove", "course", id, sub)]);
      return reviewDesk(ctx, id);
    },
  ],
  [
    "POST",
    /^\/admin\/courses\/([\w-]+)\/review-invites$/,
    async (ctx, [id]) => {
      // 指定特定會員：產生一次性的邀請網址（24 小時內有效），用分享功能傳給對方；對方登入後打開就成為這門課的審核人員。
      const s = await requireCourseManager(ctx, id);
      const token = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      await ctx.db.batch([
        ctx.db.prepare("INSERT INTO review_invites (token_hash, course_id, created_by_sub, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256(token), id, s.sub, expiresAt),
        audit(ctx.db, s.sub, "course.reviewer_invite", "course", id),
      ]);
      return { path: `/review-invite/${token}`, expiresAt };
    },
  ],
  [
    "GET",
    /^\/review-invites\/([a-f0-9]{36})$/,
    async (ctx, [token]) => {
      const s = requireMember(ctx);
      const inv = await inviteOf(ctx, token);
      return { courseId: inv.course_id, courseTitle: inv.title, expiresAt: inv.expires_at, state: inviteState(inv, s.sub) };
    },
  ],
  [
    "POST",
    /^\/review-invites\/([a-f0-9]{36})\/accept$/,
    async (ctx, [token]) => {
      const s = requireMember(ctx);
      const inv = await inviteOf(ctx, token);
      const st = inviteState(inv, s.sub);
      if (st === "expired") fail(410, "invite_expired", "這個邀請網址已超過 24 小時，請對方重新產生");
      if (st === "used") fail(410, "invite_used", "這個邀請網址已經被別人使用過了");
      if (st === "open") {
        await ctx.db.batch([
          ctx.db.prepare("UPDATE review_invites SET used_by_sub = ?, used_at = ? WHERE token_hash = ? AND used_by_sub IS NULL").bind(s.sub, iso(), await sha256(token)),
          ctx.db.prepare("INSERT OR REPLACE INTO course_reviewers (course_id, member_sub, member_name, added_by_sub) VALUES (?, ?, ?, ?)").bind(inv.course_id, s.sub, s.name.slice(0, 60), inv.created_by_sub),
          audit(ctx.db, s.sub, "course.reviewer_accept", "course", inv.course_id),
          notify(ctx.db, { sub: inv.created_by_sub }, "審核人員已加入", `${s.name}｜${inv.title}`, `/course/${inv.course_id}`),
          notify(ctx.db, { sub: s.sub }, "你已成為課程報名審核人員", inv.title, "/admin/orders"),
        ]);
      }
      return { courseId: inv.course_id, courseTitle: inv.title };
    },
  ],
  [
    "POST",
    /^\/series-views$/,
    async (ctx) => {
      // 系列頁瀏覽計數：每進入一次就 +1（與中心頁相同規則）；回傳累計次數。
      requireMember(ctx);
      const body = await readJson<{ series?: unknown }>(ctx.req);
      const name = typeof body.series === "string" ? body.series.trim().slice(0, 60) : "";
      if (!name) fail(400, "invalid_series", "請指定系列");
      return { total: await bumpView(ctx.db, "series", name) };
    },
  ],
  [
    "DELETE",
    /^\/admin\/series\/edm$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const series = keywordText(ctx.url.searchParams.get("series"));
      const old = await ctx.db.prepare("SELECT edm_key AS k, cover_key AS c FROM series_art WHERE series = ?").bind(series).first<{ k: string; c: string | null }>();
      await ctx.db.batch([ctx.db.prepare("DELETE FROM series_art WHERE series = ?").bind(series), audit(ctx.db, s.sub, "series.edm_remove", "series", series)]);
      if (old?.k) await ctx.env.MEDIA?.delete(old.k).catch(() => undefined);
      if (old?.c) await ctx.env.MEDIA?.delete(old.c).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/admin\/courses\/([\w-]+)\/duplicate$/,
    async (ctx, [id]) => {
      // 複製（建立下一梯）：要能新增課程，而且看得到（能修改）來源課程。
      const s = await requireCourseCreator(ctx);
      await requireCourseManager(ctx, id!);
      ctx.touched = undefined; // 複製不算修改來源課程
      return duplicateCourse(ctx, id!, s);
    },
  ],
  ["PATCH", /^\/admin\/courses\/([\w-]+)$/, async (ctx, [id]) => updateCourse(ctx, id)],
  [
    "GET",
    /^\/admin\/courses\/([\w-]+)\/delete-impact$/,
    async (ctx, [id]) => {
      const { can } = await courseRightsFor(ctx, id);
      if (!can.edit && !can.remove) fail(403, "forbidden", "沒有管理這門課程的權限");
      return courseDeleteImpact(ctx.db, id);
    },
  ],
  [
    "DELETE",
    /^\/admin\/courses\/([\w-]+)$/,
    async (ctx, [id]) => {
      const { s: admin, can } = await courseRightsFor(ctx, id);
      if (!can.remove) fail(403, "forbidden", "沒有刪除這門課程的權限");
      const impact = await courseDeleteImpact(ctx.db, id);
      // 業主規定：已有人報名（已開通、免費報名、待審核）的課程不能永久刪除，只能「下架封存」。完全沒人報名才真的刪除。
      const active = await registrationCount(ctx.db, id);
      if (active > 0) fail(409, "has_registrations", `這門課程已有 ${active} 筆報名，不能永久刪除；請改用「下架封存」`);
      const audio = await ctx.db.prepare("SELECT media_ref FROM lessons WHERE course_id = ? AND media_type = 'audio' AND media_ref IS NOT NULL").bind(id).all<{ media_ref: string }>();
      const files = await attachmentKeys(ctx.db, "course_id", id);
      const lessonArt = await ctx.db.prepare("SELECT cover_key, poster_key FROM lessons WHERE course_id = ?").bind(id).all<{ cover_key: string | null; poster_key: string | null }>();
      for (const r of lessonArt.results) files.push(...[r.cover_key, r.poster_key].filter((k): k is string => !!k));
      const art = await ctx.db.prepare("SELECT edm_key, cover_key FROM courses WHERE id = ?").bind(id).first<{ edm_key: string | null; cover_key: string | null }>(); // cover_key 是舊版封面（已不再使用，刪課程時順便清掉）
      // 只含這門課的報名紀錄整筆刪除；同時報名多門課的紀錄只移除這門課並扣掉金額。
      const onlyThis = "id IN (SELECT order_id FROM order_items WHERE course_id = ?1) AND NOT EXISTS (SELECT 1 FROM order_items x WHERE x.order_id = orders.id AND x.course_id <> ?1)";
      const [, , , , , , res] = await ctx.db.batch([
        ctx.db.prepare(`DELETE FROM notifications WHERE (link LIKE '/orders/%' AND substr(link, 9) IN (SELECT id FROM orders WHERE ${onlyThis})) OR (link LIKE '/admin/orders/%' AND substr(link, 15) IN (SELECT id FROM orders WHERE ${onlyThis}))`).bind(id),
        ctx.db.prepare("DELETE FROM enrollments WHERE course_id = ?").bind(id),
        ctx.db.prepare(`DELETE FROM orders WHERE ${onlyThis}`).bind(id),
        ctx.db.prepare("UPDATE orders SET total_twd = MAX(0, total_twd - (SELECT COALESCE(SUM(price_twd), 0) FROM order_items WHERE order_id = orders.id AND course_id = ?1)) WHERE id IN (SELECT order_id FROM order_items WHERE course_id = ?1)").bind(id),
        ctx.db.prepare("DELETE FROM order_items WHERE course_id = ?").bind(id),
        audit(ctx.db, admin.sub, "course.delete", "course", id, JSON.stringify({ title: impact.title, registrations: impact.registrations, students: impact.students, paidTwd: impact.paidTwd })),
        ctx.db.prepare("DELETE FROM courses WHERE id = ?").bind(id),
      ]);
      if (res.meta?.changes === 0) fail(404, "not_found", "找不到這門課程");
      for (const k of [...files, art?.edm_key, art?.cover_key]) if (k) await ctx.env.MEDIA?.delete(k).catch(() => undefined);
      for (const a of audio.results) await ctx.env.MEDIA?.delete(a.media_ref).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/admin\/courses\/([\w-]+)\/lessons$/,
    async (ctx, [courseId]) => {
      const admin = await requireCourseManager(ctx, courseId);
      const body = await readJson<{ title?: unknown; sharer?: unknown; sharerRank?: unknown; sharerTitle?: unknown; eventDate?: unknown; autoCover?: unknown; kind?: unknown; isSpeaker?: unknown; isSummary?: unknown }>(ctx.req);
      const kind = body.kind === "material" ? "material" : "chapter";
      if (kind === "chapter" && (await isListCourse(ctx, courseId))) fail(400, "list_no_chapter", "素材清單沒有章節，請用「新增教材」");
      const sharer = typeof body.sharer === "string" ? body.sharer.trim().slice(0, 60) : "";
      const sharerTitle = typeof body.sharerTitle === "string" ? body.sharerTitle.trim().slice(0, 50) : "";
      const sharerRank = typeof body.sharerRank === "string" ? body.sharerRank.trim().slice(0, 40) : "";
      await assertCentralRank(ctx, sharerRank);
      if (sharerTitle) await noteJobTitle(ctx, sharerTitle);
      const speakerNew = kind === "chapter" && body.isSpeaker === true;
      const summaryNew = kind === "chapter" && body.isSummary === true;
      const title = summaryNew ? SUMMARY_TITLE : typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
      if (speakerNew && summaryNew) fail(400, "summary_speaker_exclusive", "主講人與總結與銷售課程不能同時勾選");
      if (!title && !speakerNew) fail(400, "title_required", `請輸入${kind === "material" ? "教材" : "章節"}名稱`);
      const eventDate = body.eventDate === undefined ? null : dayOrNull(body.eventDate);
      const course = await ctx.db.prepare("SELECT (SELECT COALESCE(MAX(position), 0) FROM lessons WHERE course_id = c.id) AS maxpos FROM courses c WHERE c.id = ?").bind(courseId).first<{ maxpos: number }>();
      if (!course) return fail(404, "not_found", "找不到這門課程");
      const id = `${courseId}-${randomId(6)}`;
      // 「完整版課程影片」永遠是教材的最後一列：新教材插在它前面，它往後挪一格。
      const full = kind === "material" ? await ctx.db.prepare("SELECT id, position FROM lessons WHERE course_id = ? AND is_full = 1").bind(courseId).first<{ id: string; position: number }>() : null;
      const speaker = speakerNew;
      await ctx.db.batch([
        ...(speaker ? [ctx.db.prepare("UPDATE lessons SET is_speaker = 0 WHERE course_id = ?").bind(courseId)] : []),
        ...(summaryNew ? [ctx.db.prepare("UPDATE lessons SET is_summary = 0 WHERE course_id = ?").bind(courseId)] : []),
        ...(full ? [ctx.db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(course.maxpos + 1, full.id)] : []),
        ctx.db.prepare("INSERT INTO lessons (id, course_id, position, title, sharer, sharer_rank, sharer_title, duration_minutes, media_type, event_date, auto_cover, kind, is_speaker, is_summary) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'demo', ?, ?, ?, ?, ?)").bind(id, courseId, full ? full.position : course.maxpos + 1, title || "主講人", sharer, sharerRank, sharerTitle, eventDate, 0, kind, speaker ? 1 : 0, summaryNew ? 1 : 0),
        ...(speaker ? [speakerSync(ctx.db, courseId)] : []),
        audit(ctx.db, admin.sub, "lesson.create", "lesson", id, `${kind}:${title}`),
      ]);
      return courseDetail(ctx, courseId);
    },
  ],
  [
    "POST",
    /^\/admin\/courses\/([\w-]+)\/full-version$/,
    async (ctx, [courseId]) => {
      // 勾選「完整版課程影片」：在教材最後新增一列；章節都用同一支影片時自動帶入（秒數留空＝播整支）。已存在就直接回傳。
      const admin = await requireCourseManager(ctx, courseId);
      if (await isListCourse(ctx, courseId)) fail(400, "list_no_full", "素材清單沒有完整版課程影片");
      if (!(await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").bind(courseId).first())) return fail(404, "not_found", "找不到這門課程");
      if (!(await ctx.db.prepare("SELECT 1 AS ok FROM lessons WHERE course_id = ? AND is_full = 1").bind(courseId).first())) {
        const chapters = await ctx.db
          .prepare("SELECT media_type, media_ref, duration_minutes FROM lessons WHERE course_id = ? AND kind = 'chapter' ORDER BY position")
          .bind(courseId)
          .all<{ media_type: MediaType; media_ref: string | null; duration_minutes: number }>();
        const withMedia = chapters.results.filter((l) => l.media_ref && l.media_type !== "demo");
        const same = withMedia.length > 0 && withMedia.every((l) => l.media_type === withMedia[0]!.media_type && l.media_ref === withMedia[0]!.media_ref);
        const maxpos = (await ctx.db.prepare("SELECT COALESCE(MAX(position), 0) AS p FROM lessons WHERE course_id = ?").bind(courseId).first<{ p: number }>())?.p ?? 0;
        const id = `${courseId}-${randomId(6)}`;
        await ctx.db.batch([
          ctx.db
            .prepare("INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type, media_ref, kind, is_full) VALUES (?, ?, ?, '完整版課程影片', ?, ?, ?, 'material', 1)")
            .bind(id, courseId, maxpos + 1, same ? withMedia.reduce((n, l) => n + l.duration_minutes, 0) : 0, same ? withMedia[0]!.media_type : "demo", same ? withMedia[0]!.media_ref : null),
          audit(ctx.db, admin.sub, "lesson.create", "lesson", id, "material:完整版課程影片"),
        ]);
      }
      return courseDetail(ctx, courseId);
    },
  ],
  [
    "POST",
    /^\/admin\/lessons\/([\w-]+)\/duplicate$/,
    async (ctx, [id]) => {
      // 複製一堂（章節或教材）：插在原本那堂後面。影片來源（YouTube／Mux）用同一支；音檔是這堂自己的檔案，不共用（複製後請重新上傳）。
      const admin = await requireLessonManager(ctx, id);
      const l = await ctx.db
        .prepare("SELECT course_id, position, title, sharer, sharer_rank, sharer_title, duration_minutes, media_type, media_ref, start_seconds, end_seconds, event_date, auto_cover, kind, is_full FROM lessons WHERE id = ?")
        .bind(id)
        .first<{ course_id: string; position: number; title: string; sharer: string; sharer_rank: string; sharer_title: string; duration_minutes: number; media_type: MediaType; media_ref: string | null; start_seconds: number | null; end_seconds: number | null; event_date: string | null; auto_cover: number; kind: string; is_full: number }>();
      if (!l) return fail(404, "not_found", "找不到這一堂");
      if (l.is_full === 1) fail(400, "full_version", "完整版課程影片不能複製");
      const audio = l.media_type === "audio";
      const newId = `${l.course_id}-${randomId(6)}`;
      const after = await ctx.db.prepare("SELECT id, position FROM lessons WHERE course_id = ? AND position > ? ORDER BY position DESC").bind(l.course_id, l.position).all<{ id: string; position: number }>();
      await ctx.db.batch([
        // 後面的往後挪一格（由大到小，避開 UNIQUE(course_id, position)），再把複製的放在原本那堂的下一格。
        ...after.results.map((r) => ctx.db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(r.position + 1, r.id)),
        ctx.db
          .prepare("INSERT INTO lessons (id, course_id, position, title, sharer, sharer_rank, sharer_title, duration_minutes, media_type, media_ref, start_seconds, end_seconds, event_date, auto_cover, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(newId, l.course_id, l.position + 1, `${l.title}（複製）`.slice(0, 120), l.sharer, l.sharer_rank, l.sharer_title, audio ? 0 : l.duration_minutes, audio ? "demo" : l.media_type, audio ? null : l.media_ref, audio ? null : l.start_seconds, audio ? null : l.end_seconds, l.event_date, l.auto_cover, l.kind),
        audit(ctx.db, admin.sub, "lesson.duplicate", "lesson", newId, id),
      ]);
      return courseDetail(ctx, l.course_id);
    },
  ],
  [
    "POST",
    /^\/admin\/courses\/([\w-]+)\/lessons\/order$/,
    async (ctx, [courseId]) => {
      const admin = await requireCourseManager(ctx, courseId);
      const body = await readJson<{ ids?: unknown }>(ctx.req);
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
      // 章節與教材各自排序：傳進來的 ids 必須剛好是同一組（章節或教材）的全部；排好後放回這一組原本佔用的順位，另一組不動。
      const current = await ctx.db.prepare("SELECT id, kind, position FROM lessons WHERE course_id = ? AND is_full = 0").bind(courseId).all<{ id: string; kind: string; position: number }>();
      const byId = new Map(current.results.map((r) => [r.id, r]));
      const first = ids.length ? byId.get(ids[0]!) : undefined;
      const group = current.results.filter((r) => r.kind === (first?.kind ?? "chapter"));
      if (!first || ids.length !== group.length || new Set(ids).size !== ids.length || ids.some((i) => byId.get(i)?.kind !== first.kind)) fail(400, "invalid_order", "順序不正確，請重新整理後再試");
      const slots = group.map((r) => r.position).sort((x, y) => x - y);
      // 先移到負數避開 UNIQUE(course_id, position)，再寫入新順序。
      await ctx.db.batch([
        ctx.db.prepare(`UPDATE lessons SET position = -position WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids),
        ...ids.map((id, i) => ctx.db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(slots[i]!, id)),
        audit(ctx.db, admin.sub, "lesson.reorder", "course", courseId),
      ]);
      return courseDetail(ctx, courseId);
    },
  ],
];

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
    const ctx = await context(req, env, url);
    const out = await handler(ctx, [...re.exec(path)!].slice(1));
    if (ctx.touched && ctx.session) await touchCourse(env.DB, ctx.touched, ctx.session).run().catch(() => undefined);
    res = out instanceof Response ? out : json(out);
  } catch (e) {
    if (e instanceof HttpError) res = json({ error: { code: e.code, message: e.message } }, e.status);
    else {
      console.error("api error", e);
      res = json({ error: { code: "internal", message: "系統忙碌，請稍後再試" } }, 500);
    }
  }
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  // 伺服器處理時間（含向會員中心查詢），方便在瀏覽器開發者工具的 Network → Timing 看哪一步慢。
  res.headers.set("server-timing", `app;dur=${Date.now() - started}`);
  // 有寫入動作時，把新產生的站內通知也寄成 Email（背景處理，失敗不影響回應）。
  if (req.method !== "GET" && res.status < 400 && env.EMAIL) {
    const job = flushEmails(env).catch((e) => console.error("flush emails", e instanceof Error ? e.message : "error"));
    if (exec) exec.waitUntil(job);
    else await job;
  }
  return res;
}

/** 不需要登入身分的公開路徑：不必為它們向會員中心查詢（首頁的公告、金句、設定每次都會打）。 */
const NO_SESSION = /^\/api\/v2\/(announcements|quotes\/random|config|central\/webhook|media\/(pub|img|file|audio))(\?|$)/;

async function context(req: Request, env: Env, url: URL): Promise<Ctx> {
  const light = /^\/api\/v2\/me\/(central-profile|vocab)$/.test(url.pathname);
  const session = NO_SESSION.test(url.pathname) ? null : await loadSession(env, req, req.method === "GET" && url.pathname === "/api/v2/me", light);
  return { env, db: env.DB, req, url, platform: platformOf(req), session };
}
