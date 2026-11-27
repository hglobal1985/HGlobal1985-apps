/** 行動大學 API 共用核心：課程資料：課程清單、課程頁、報名狀態（杜杜龍 2026-11-27 從 api-core.ts 依功能拆出；api-core.ts 會全部轉出，舊的 import 不用改）。 */
import { HQ_SLUG } from "../short-links.ts";
import { type CourseSummary, type Rank, VIEW_SCOPES, type ViewScope, zoneOf } from "../contract.ts";
import type { D1Database } from "../d1.ts";
import { type Ctx, type Session, brandFor, eligibilityFor, fail, iso, loadBlocks, loadBrands, ranks } from "./base.ts";
import { type Rights, centerSlugMap, courseCan, hostCenterOf, pubUrl, rightsOf, seriesSlugMap } from "./course-admin.ts";
import { parseCoverRect } from "./library.ts";

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
