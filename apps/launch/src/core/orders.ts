/** 行動大學 API 共用核心：報名與審核、報名名單（杜杜龍 2026-11-27 從 api-core.ts 依功能拆出；api-core.ts 會全部轉出，舊的 import 不用改）。 */
import type { Roster, RosterRow, Order, PaymentMethodKey } from "../contract.ts";
import { lastUplineError, lookupUplines } from "../central.ts";
import type { D1Database, D1PreparedStatement } from "../d1.ts";
import { type Ctx, type Session, audit, fail, iso, notify, requireMember } from "./base.ts";
import { courseCan, rightsOf } from "./course-admin.ts";
import { csvCell, dutyOf, orderDetail } from "./series.ts";
import { text } from "./library.ts";

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
