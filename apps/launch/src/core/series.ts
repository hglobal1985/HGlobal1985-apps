/** 行動大學 API 共用核心：系列套用到全系列、小編與中心 EDM 檢查（杜杜龍 2026-11-27 從 api-core.ts 依功能拆出；api-core.ts 會全部轉出，舊的 import 不用改）。 */
import { REVIEW_REASONS, applicantLabel, SERIES_APPLY_FIELDS, SERIES_PRICE_FIELDS, type SeriesApplyPlan, type SeriesApplyResult, type SeriesRosterPlan, type OrderEvent, type ReviewAction, type ReviewReason, type CourseEditor, NOTICE_KINDS, type NoticeKind, type NotificationSettings, type Order, type PaymentMethodKey, type PaymentReport, type RegistrationReport, type ReportBy, type ReportRow } from "../contract.ts";
import { centerKey, contactEmail, legalNameOf, reportIntegration } from "../central.ts";
import type { D1PreparedStatement } from "../d1.ts";
import { type Ctx, HttpError, type Session, audit, eligibilityFor, fail, iso, notify, orderId, payRef, ranks, readJson, requireMember, requireSuperAdmin } from "./base.ts";
import { DIAMOND, MATERIAL_LIKE_SQL, byPresident, earlyActive, inFreeWindow, memberCourseState, scopeAllows } from "./courses.ts";
import { type EditorFlags, type Rights, rightsOf } from "./course-admin.ts";
import { ORDER_SELECT, type OrderRow, type RegItem, type ReviewScope, canReviewOrder, event, hasScope, hydrateOrders, reviewScope, reviewerNotices, scopeSql, titleOf } from "./orders.ts";
import { assertCentralCenters, text } from "./library.ts";
import { updateCourseWith } from "./keywords.ts";

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
