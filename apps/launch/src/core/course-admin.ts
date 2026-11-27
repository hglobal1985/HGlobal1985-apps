/** 行動大學 API 共用核心：課程管理：管理權限（總部、會長、音控、小編）、教材檔案（杜杜龍 2026-11-27 從 api-core.ts 依功能拆出；api-core.ts 會全部轉出，舊的 import 不用改）。 */
import { kickFilePhotos } from "../block-photos.ts";
import { romanizeName, romanizeTitle } from "../romanize.ts";
import { HQ_UNIT, type CourseDetail, type CourseCan, type AttachmentType, type CourseDeleteImpact, type Rank, REVIEW_ROLES, type ReviewDesk, type ReviewRole, type ViewScope, type ThumbSettings, type CoverScope, type CoverMediaItem } from "../contract.ts";
import { centerKey } from "../central.ts";
import type { D1Database, D1PreparedStatement, Env } from "../d1.ts";
import { itemIconType } from "../link-rules.ts";
import { type Ctx, type Session, audit, brandForBlock, eligibilityFor, fail, iso, loadBlocks, loadBrands, notify, ranks, requireMember, requireSuperAdmin, sha256 } from "./base.ts";
import { COURSE_SELECT, type CourseRow, DIAMOND, MATERIAL_LIKE_SQL, type MemberState, byPresident, isPrivate, keepsAccess, materialLike, memberCourseState, scopeAllows, summarize } from "./courses.ts";
import { canSeeRoster } from "./orders.ts";
import type { MediaType } from "./series.ts";
import { coverItem, randomId, requireCenterArt } from "./media.ts";
import { splitCats } from "./library.ts";

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
