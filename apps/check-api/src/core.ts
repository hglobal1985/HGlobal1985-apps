/** 寰宇繳作業系統 API 共用核心（杜杜龍 2026-11-27 從 api.ts 拆出）：型別、權限、資料轉換、通知與推播、路由表 routes 與登記函式 on。 */
import { isSuperAdmin, lookupContactEmails, ownProfile, verifyAccessToken } from "./central.ts";
import { KINDS, pointsFor, type ActivityCard, type ActivitySettings, type ActivityView, type CommentView, type FileView, type GroupView, type ItemCard, type ItemMode, type ItemView, type Kind, type PeopleView, type Person, type QueueEntry, type Role, type SubmissionView, type SubStatus } from "./contract.ts";
import type { D1Database, Env } from "./env.ts";
import { sendPush, vapidPublicKey } from "../../../packages/server-shared/src/web-push.ts";
import { flushNoticePushes } from "../../../packages/server-shared/src/notice-push.ts";

/**
 * 寰宇繳作業系統 API（/api/…）。每個請求都在這裡驗證身分與權限；前端隱藏按鈕不算權限控制。
 * 權限：
 * - 活動管理員＝中央超級管理員，或在這個活動被設為 manager 的人。
 * - 老師＝活動管理員，或在這個活動被設為 teacher 的人。只有老師能評分。
 * - 組長：看自己這組全部（含分數）、確認或退回組員作業、留言、編自己這組；不能評分、不能指定組長。
 * - 學員：交自己的作業；看同組已送出的作業（分數預設看不到）。
 */

export const API_VERSION = "0.1.0";

export type Row = Record<string, unknown>;
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export const rid = (n = 12) => {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => a[x % a.length]).join("");
};
export const now = () => new Date().toISOString();
export const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
export const bool = (v: unknown) => v === true || v === 1 || v === "1";

export type Ctx = { env: Env; sub: string; token: string; bg: (p: Promise<unknown>) => void; superAdmin?: boolean };

export async function authenticate(req: Request, env: Env): Promise<{ sub: string; token: string } | null> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) return null;
  if (env.DEV_LOGIN === "on" && token.startsWith("dev:")) return { sub: token.slice(4, 60), token };
  const sub = await verifyAccessToken(token);
  return sub ? { sub, token } : null;
}
export async function superAdmin(c: Ctx): Promise<boolean> {
  if (c.superAdmin === undefined) {
    if (c.env.DEV_LOGIN === "on" && c.token.startsWith("dev:")) c.superAdmin = c.sub.startsWith("admin");
    else c.superAdmin = await isSuperAdmin(c.sub, c.token);
  }
  return c.superAdmin;
}

/** 顯示名稱的必要副本：本人每次使用時（最多 10 分鐘一次）從中央讀取更新。 */
export async function refreshPerson(c: Ctx): Promise<void> {
  if (c.token.startsWith("dev:")) {
    await c.env.DB.prepare("INSERT INTO people (member_id, display_name) VALUES (?, ?) ON CONFLICT(member_id) DO NOTHING").bind(c.sub, c.sub).run();
    return;
  }
  const p = await ownProfile(c.sub, c.token);
  if (!p) return;
  await c.env.DB.prepare(
    "INSERT INTO people (member_id, display_name, avatar_url, stale, updated_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(member_id) DO UPDATE SET display_name = excluded.display_name, avatar_url = excluded.avatar_url, stale = 0, updated_at = excluded.updated_at",
  )
    .bind(c.sub, p.name, p.avatarUrl, now())
    .run();
}

// ───────────── 權限 ─────────────
export type Membership = { role: Role; status: string; groupId: string | null; isLeader: boolean } | null;
export async function membership(db: D1Database, activityId: string, sub: string): Promise<Membership> {
  const r = await db.prepare("SELECT role, status, group_id, is_leader FROM members WHERE activity_id = ? AND member_id = ?").bind(activityId, sub).first<Row>();
  if (!r || r.status === "removed") return null;
  return { role: r.role as Role, status: String(r.status), groupId: (r.group_id as string) ?? null, isLeader: !!r.is_leader };
}
export type Access = { activity: Row; m: Membership; role: Role; manager: boolean; teacher: boolean; active: boolean };
export async function access(c: Ctx, activityId: string): Promise<Access> {
  const activity = await c.env.DB.prepare("SELECT * FROM activities WHERE id = ?").bind(activityId).first<Row>();
  if (!activity) fail(404, "找不到這份作業");
  const m = await membership(c.env.DB, activityId, c.sub);
  const sa = await superAdmin(c);
  const manager = sa || (m?.role === "manager" && m.status === "active");
  const teacher = manager || (m?.role === "teacher" && m.status === "active");
  if (!teacher) {
    if (!m) fail(403, "你還沒加入這份作業");
    if (activity!.status === "draft") fail(403, "這份作業還沒開放");
  }
  return { activity: activity!, m, role: manager ? "manager" : teacher ? "teacher" : "student", manager, teacher, active: teacher || m?.status === "active" };
}
export const needActive = (a: Access) => {
  if (!a.active) fail(403, "等待管理員核准加入");
};
export const needTeacher = (a: Access) => {
  if (!a.teacher) fail(403, "只有老師可以做這件事");
};
export const needManager = (a: Access) => {
  if (!a.manager) fail(403, "只有管理員可以做這件事");
};

// ───────────── 資料轉換 ─────────────
export function itemCard(r: Row): ItemCard {
  return {
    id: String(r.id),
    lessonId: String(r.lesson_id),
    name: String(r.name),
    note: String(r.note ?? ""),
    mode: r.mode as ItemMode,
    per: num(r.per),
    unit: String(r.unit ?? "件"),
    maxPoints: num(r.max_points),
    minCount: num(r.min_count),
    points: num(r.points),
    fullScore: num(r.full_score),
    inTotal: !!r.in_total,
    kinds: String(r.kinds ?? "").split(",").filter((k) => k in KINDS) as Kind[],
    lateAllowed: r.late_allowed == null ? null : !!r.late_allowed,
  };
}
export function settings(a: Row): ActivitySettings {
  return {
    id: String(a.id),
    title: String(a.title),
    summary: String(a.summary ?? ""),
    startsOn: (a.starts_on as string) ?? null,
    endsOn: (a.ends_on as string) ?? null,
    status: a.status as ActivitySettings["status"],
    joinCode: String(a.join_code),
    joinApproval: !!a.join_approval,
    lateAllowed: !!a.late_allowed,
    autoRemind: !!a.auto_remind,
    peersSeeScores: !!a.peers_see_scores,
    retentionUntil: retentionOf(a),
    filesPurgedAt: (a.files_purged_at as string) ?? null,
  };
}
export async function names(db: D1Database, ids: string[]): Promise<Map<string, { name: string; avatarUrl: string | null }>> {
  const out = new Map<string, { name: string; avatarUrl: string | null }>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 90) {
    const part = uniq.slice(i, i + 90);
    const rs = await db.prepare(`SELECT member_id, display_name, avatar_url FROM people WHERE member_id IN (${part.map(() => "?").join(",")})`).bind(...part).all<Row>();
    for (const r of rs.results) out.set(String(r.member_id), { name: String(r.display_name || ""), avatarUrl: (r.avatar_url as string) ?? null });
  }
  return out;
}
export const nameOr = (m: Map<string, { name: string }>, id: string) => m.get(id)?.name || "學員";

export function fileView(r: Row): FileView {
  const f: FileView = { id: String(r.id), kind: r.kind as Kind, name: String(r.name ?? ""), size: Number(r.size ?? 0), contentType: String(r.content_type ?? "") };
  if (r.kind === "link") f.url = String(r.url ?? "");
  if (r.kind === "text") f.body = String(r.body ?? "");
  return f;
}
export const ROLE_LABEL: Record<string, string> = { student: "學員", teacher: "老師", manager: "管理員", leader: "組長" };

export async function submissionView(c: Ctx, s: Row, opts: { hideScores: boolean; withComments: boolean }): Promise<SubmissionView> {
  const db = c.env.DB;
  const fileRows = (await db.prepare("SELECT * FROM files WHERE submission_id = ? ORDER BY position, created_at").bind(s.id).all<Row>()).results;
  const files = fileRows.map(fileView);
  // 照片直接附上 10 分鐘有效的讀取憑證（畫面要顯示縮圖；只有看得到這份作業的人才會拿到）
  const photos = fileRows.filter((f) => f.kind === "photo" && f.r2_key);
  if (photos.length) {
    const exp = Date.now() + 600_000;
    const ts = photos.map((f) => ({ f, t: rid(24) }));
    await db.batch(ts.map(({ f, t }) => db.prepare("INSERT INTO tickets (id, file_id, member_id, expires_at) VALUES (?, ?, ?, ?)").bind(t, f.id, c.sub, exp)));
    for (const { f, t } of ts) {
      const v = files.find((x) => x.id === f.id);
      if (v) v.url = `/f/${t}`;
    }
  }
  let comments: CommentView[] = [];
  if (opts.withComments) {
    const rows = (await db.prepare("SELECT * FROM comments WHERE submission_id = ? AND hidden = 0 ORDER BY created_at").bind(s.id).all<Row>()).results;
    const roles = new Map<string, string>();
    if (rows.length) {
      const ms = await db.prepare("SELECT member_id, role, is_leader FROM members WHERE activity_id = ?").bind(s.activity_id).all<Row>();
      for (const m of ms.results) roles.set(String(m.member_id), m.role === "student" ? (m.is_leader ? "leader" : "student") : String(m.role));
    }
    const nm = await names(db, rows.map((r) => String(r.member_id)));
    comments = rows.map((r) => ({
      id: String(r.id),
      memberId: String(r.member_id),
      name: nameOr(nm, String(r.member_id)),
      roleLabel: ROLE_LABEL[roles.get(String(r.member_id)) ?? "manager"] ?? "管理員",
      body: String(r.body),
      createdAt: String(r.created_at),
      mine: r.member_id === c.sub,
    }));
  }
  const nm = await names(db, [String(s.member_id)]);
  const hide = opts.hideScores;
  return {
    id: String(s.id),
    itemId: String(s.item_id),
    memberId: String(s.member_id),
    name: nameOr(nm, String(s.member_id)),
    status: s.status as SubStatus,
    declared: num(s.declared),
    approved: hide ? null : num(s.approved),
    note: String(s.note ?? ""),
    points: hide ? null : num(s.points),
    score: hide ? null : num(s.score),
    stars: hide ? null : num(s.stars),
    comment: hide ? "" : String(s.comment ?? ""),
    leaderNote: String(s.leader_note ?? ""),
    gradedAt: hide ? null : ((s.graded_at as string) ?? null),
    submittedAt: (s.submitted_at as string) ?? null,
    late: !!s.late,
    files,
    comments,
  };
}

export async function totalOf(db: D1Database, activityId: string, sub: string): Promise<number> {
  const r = await db
    .prepare("SELECT COALESCE(SUM(s.points), 0) AS t FROM submissions s JOIN items i ON i.id = s.item_id WHERE s.activity_id = ? AND s.member_id = ? AND s.status = 'graded' AND i.in_total = 1")
    .bind(activityId, sub)
    .first<Row>();
  return Math.round(Number(r?.t ?? 0) * 10) / 10;
}

export async function notify(db: D1Database, memberIds: string[], title: string, body: string, link: string, opts: { email?: boolean } = {}): Promise<void> {
  const ids = [...new Set(memberIds)].filter(Boolean);
  if (!ids.length) return;
  await db.batch(ids.map((m) => db.prepare("INSERT INTO notices (id, member_id, title, body, link, email) VALUES (?, ?, ?, ?, ?, ?)").bind(rid(), m, title.slice(0, 80), body.slice(0, 300), link, opts.email ? 1 : 0)));
  pushSoon?.();
}

export const SITE = "https://check.hglobal1985.com";
export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
/**
 * 寄出標記要寄 Email 的站內通知（目前只有作業檔案備份與刪除提醒；杜杜龍 2026-11-27）。
 * 信箱寄信當下才向中央查（聯絡查詢，用完即丟）；沒有寄信綁定或中央服務金鑰就不寄，站內通知與推播照常。先標記再寄：寧可漏寄也不重複寄。
 */
export async function flushEmails(env: Env): Promise<number> {
  if (!env.EMAIL || !env.EMAIL_FROM || !env.CENTRAL_SERVICE_SECRET) return 0;
  const db = env.DB;
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const rows = (await db.prepare("SELECT id, member_id, title, body, link FROM notices WHERE email = 1 AND emailed = 0 AND created_at >= ? ORDER BY created_at LIMIT 100").bind(since).all<Row>()).results;
  if (!rows.length) return 0;
  await db.batch(rows.map((n) => db.prepare("UPDATE notices SET emailed = 1 WHERE id = ?").bind(n.id)));
  const to = await lookupContactEmails(env.CENTRAL_SERVICE_SECRET, rows.map((n) => String(n.member_id)), "course_notice");
  let sent = 0;
  for (const n of rows) {
    const email = to.get(String(n.member_id));
    if (!email) continue;
    const link = `${SITE}${String(n.link).startsWith("/") ? n.link : `/${n.link}`}`;
    const text = `${n.body}\n\n立即下載備份：${link}\n\n——\n寰宇繳作業系統`;
    const html = `<div style="font-family:sans-serif;line-height:1.6"><h3>${esc(String(n.title))}</h3><p>${esc(String(n.body)).replace(/\n/g, "<br>")}</p><p><a href="${esc(link)}" style="display:inline-block;background:#14663F;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">立即下載備份</a></p><hr><p style="color:#888;font-size:12px">寰宇繳作業系統</p></div>`;
    try {
      await env.EMAIL.send({ from: { email: env.EMAIL_FROM, name: "寰宇繳作業系統" }, to: email, subject: String(n.title), text, html });
      sent++;
    } catch (e) {
      console.error("email send failed", e instanceof Error ? e.message : "error");
    }
  }
  return sent;
}

/** 作業檔案的刪除日期：有設定就用設定的；沒設定就是「活動結束日後 2 個月」（杜杜龍 2026-11-27）；兩個都沒有就不自動刪除。 */
export function retentionOf(a: Row): string | null {
  if (a.retention_until) return String(a.retention_until);
  const end = typeof a.ends_on === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(a.ends_on) : null;
  if (!end) return null;
  return new Date(Date.UTC(Number(end[1]), Number(end[2]) - 1 + 2, Number(end[3]))).toISOString().slice(0, 10);
}
/** 每個請求開始時設定：站內通知新增後，在背景把它推到手機（handleApi 設定；排程另外每小時補推一次）。 */
export let pushSoon: (() => void) | null = null;
/** handleApi／排程設定「新增通知後要不要在背景推播」（拆檔後跨檔案改值要經過這個函式）。 */
export function setPushSoon(fn: (() => void) | null): void {
  pushSoon = fn;
}

export const PUSH_SUBJECT = "https://check.hglobal1985.com";
/** 把最近 30 分鐘內還沒推播的站內通知推出去（先標記再推：寧可漏推也不重複推）。回傳推出去的則數。 */
export async function flushPushes(env: Env, fetcher: typeof fetch = fetch): Promise<number> {
  if (!vapidPublicKey(env.VAPID_PRIVATE_JWK)) return 0;
  const db = env.DB;
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  // 推播流程是共用模組（packages/server-shared/src/notice-push.ts，與行動大學同一份）；這裡只提供繳作業系統的資料表怎麼讀寫。
  return flushNoticePushes<Row & { id: string; title: string; body: string; link: string }>({
    pending: async () => (await db.prepare("SELECT id, member_id, title, body, link FROM notices WHERE pushed = 0 AND created_at >= ? ORDER BY created_at LIMIT 50").bind(since).all<Row & { id: string; title: string; body: string; link: string }>()).results,
    claim: async (n) => ((await db.prepare("UPDATE notices SET pushed = 1 WHERE id = ? AND pushed = 0").bind(n.id).run()).meta?.changes ?? 0) > 0,
    devices: async (n) => (await db.prepare("SELECT endpoint, p256dh, auth FROM push_subs WHERE member_id = ?").bind(n.member_id).all<{ endpoint: string; p256dh: string; auth: string }>()).results,
    send: (d, msg) => sendPush(env.VAPID_PRIVATE_JWK, PUSH_SUBJECT, d, msg, fetcher),
    onGone: (d) => db.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(d.endpoint).run(),
    onError: (d) => db.prepare("UPDATE push_subs SET failures = failures + 1 WHERE endpoint = ?").bind(d.endpoint).run(),
    cleanup: () => db.prepare("DELETE FROM push_subs WHERE failures >= 20").run(),
  });
}

export const deadlinePassed = (dueAt: unknown) => typeof dueAt === "string" && dueAt !== "" && Date.parse(dueAt) < Date.now();
export const lateOk = (item: Row, activity: Row) => (item.late_allowed == null ? !!activity.late_allowed : !!item.late_allowed);

// ───────────── 首頁 ─────────────
export async function home(c: Ctx): Promise<ActivityCard[]> {
  const db = c.env.DB;
  const sa = await superAdmin(c);
  const rows = sa
    ? (await db.prepare("SELECT a.*, m.role AS m_role, m.status AS m_status, m.group_id, m.is_leader FROM activities a LEFT JOIN members m ON m.activity_id = a.id AND m.member_id = ? ORDER BY a.created_at DESC").bind(c.sub).all<Row>()).results
    : (await db.prepare("SELECT a.*, m.role AS m_role, m.status AS m_status, m.group_id, m.is_leader FROM activities a JOIN members m ON m.activity_id = a.id AND m.member_id = ? WHERE m.status != 'removed' ORDER BY a.created_at DESC").bind(c.sub).all<Row>()).results;
  const out: ActivityCard[] = [];
  for (const a of rows) {
    const role: Role = sa ? "manager" : (a.m_role as Role) ?? "student";
    const teacher = role !== "student";
    if (!teacher && a.status === "draft") continue;
    const pending = !teacher && a.m_status === "pending";
    const group = a.group_id ? await db.prepare("SELECT name FROM groups WHERE id = ?").bind(a.group_id).first<Row>() : null;
    const card: ActivityCard = {
      id: String(a.id),
      title: String(a.title),
      startsOn: (a.starts_on as string) ?? null,
      endsOn: (a.ends_on as string) ?? null,
      status: a.status as ActivityCard["status"],
      role,
      pending,
      groupName: group ? String(group.name) : null,
      isLeader: !!a.is_leader,
      total: 0,
      todo: 0,
      returned: 0,
      toReview: 0,
      nextDue: null,
      filesPurged: !!a.files_purged_at,
    };
    const next = await db.prepare("SELECT title, due_at FROM lessons WHERE activity_id = ? AND due_at > ? ORDER BY due_at LIMIT 1").bind(a.id, now()).first<Row>();
    if (next) card.nextDue = { lessonTitle: String(next.title), dueAt: String(next.due_at) };
    if (teacher) {
      card.toReview = Number((await db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE activity_id = ? AND status IN ('submitted','leader_ok')").bind(a.id).first<Row>())?.n ?? 0);
    } else if (!pending) {
      card.total = await totalOf(db, String(a.id), c.sub);
      const st = (await db.prepare("SELECT status FROM submissions WHERE activity_id = ? AND member_id = ?").bind(a.id, c.sub).all<Row>()).results;
      card.returned = st.filter((s) => s.status === "returned").length;
      // 待繳＝已開放、還沒截止（或允許補交）、需要上傳、自己還沒送出的項目
      const open = await db
        .prepare(
          "SELECT COUNT(*) AS n FROM items i JOIN lessons l ON l.id = i.lesson_id WHERE i.activity_id = ? AND i.mode != 'onsite' AND (l.due_at IS NULL OR l.due_at > ?) AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.item_id = i.id AND s.member_id = ? AND s.status IN ('submitted','leader_ok','graded'))",
        )
        .bind(a.id, now(), c.sub)
        .first<Row>();
      card.todo = Number(open?.n ?? 0);
      if (a.is_leader) card.toReview = Number((await db.prepare("SELECT COUNT(*) AS n FROM submissions s JOIN members m ON m.activity_id = s.activity_id AND m.member_id = s.member_id WHERE s.activity_id = ? AND m.group_id = ? AND s.status = 'submitted' AND s.member_id != ?").bind(a.id, a.group_id, c.sub).first<Row>())?.n ?? 0);
    }
    out.push(card);
  }
  return out;
}

// ───────────── 一份作業 ─────────────
export async function activityView(c: Ctx, id: string): Promise<ActivityView> {
  const a = await access(c, id);
  const db = c.env.DB;
  const lessons = (await db.prepare("SELECT * FROM lessons WHERE activity_id = ? ORDER BY position").bind(id).all<Row>()).results;
  const items = (await db.prepare("SELECT * FROM items WHERE activity_id = ? ORDER BY position, created_at").bind(id).all<Row>()).results.map(itemCard);
  const subs = (await db.prepare("SELECT item_id, member_id, status, points, late FROM submissions WHERE activity_id = ?").bind(id).all<Row>()).results;
  const students = Number((await db.prepare("SELECT COUNT(*) AS n FROM members WHERE activity_id = ? AND role = 'student' AND status = 'active'").bind(id).first<Row>())?.n ?? 0);
  for (const it of items) {
    if (a.teacher) {
      const mine = subs.filter((s) => s.item_id === it.id);
      it.stats = {
        submitted: mine.filter((s) => s.status !== "draft").length,
        toReview: mine.filter((s) => s.status === "submitted" || s.status === "leader_ok").length,
        graded: mine.filter((s) => s.status === "graded").length,
        students,
      };
    } else {
      const s = subs.find((x) => x.item_id === it.id && x.member_id === c.sub);
      it.my = s ? { status: s.status as SubStatus, points: s.status === "graded" ? num(s.points) : null, late: !!s.late } : null;
    }
  }
  const group = a.m?.groupId ? await db.prepare("SELECT name FROM groups WHERE id = ?").bind(a.m.groupId).first<Row>() : null;
  return {
    activity: a.teacher ? settings(a.activity) : { ...settings(a.activity), joinCode: "" },
    role: a.role,
    isLeader: !!a.m?.isLeader,
    groupId: a.m?.groupId ?? null,
    groupName: group ? String(group.name) : null,
    total: a.teacher ? 0 : await totalOf(db, id, c.sub),
    lessons: lessons.map((l) => ({ id: String(l.id), position: Number(l.position), title: String(l.title), dueAt: (l.due_at as string) ?? null, items: items.filter((i) => i.lessonId === l.id) })),
    counts: {
      students,
      groups: Number((await db.prepare("SELECT COUNT(*) AS n FROM groups WHERE activity_id = ?").bind(id).first<Row>())?.n ?? 0),
      pendingJoin: a.manager ? Number((await db.prepare("SELECT COUNT(*) AS n FROM members WHERE activity_id = ? AND status = 'pending'").bind(id).first<Row>())?.n ?? 0) : 0,
      toReview: a.teacher ? subs.filter((s) => s.status === "submitted" || s.status === "leader_ok").length : 0,
    },
  };
}

export async function loadItem(c: Ctx, itemId: string) {
  const item = await c.env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(itemId).first<Row>();
  if (!item) fail(404, "找不到這個作業項目");
  const lesson = (await c.env.DB.prepare("SELECT * FROM lessons WHERE id = ?").bind(item!.lesson_id).first<Row>())!;
  const a = await access(c, String(item!.activity_id));
  return { item: item!, lesson, a };
}

export async function itemView(c: Ctx, itemId: string): Promise<ItemView> {
  const { item, lesson, a } = await loadItem(c, itemId);
  needActive(a);
  const db = c.env.DB;
  const card = itemCard(item);
  const passed = deadlinePassed(lesson.due_at);
  const late = lateOk(item, a.activity);
  const mineRow = await db.prepare("SELECT * FROM submissions WHERE item_id = ? AND member_id = ?").bind(itemId, c.sub).first<Row>();
  const my = mineRow && !a.teacher ? await submissionView(c, mineRow, { hideScores: false, withComments: true }) : null;
  const purged = !!a.activity.files_purged_at;
  const status = (mineRow?.status as SubStatus) ?? null;
  const canEdit = !a.teacher && card.mode !== "onsite" && !purged && (status === null || status === "draft" || status === "returned") && (!passed || late) && a.activity.status !== "closed";
  const view: ItemView = {
    activityId: String(a.activity.id),
    activityTitle: String(a.activity.title),
    item: card,
    lesson: { id: String(lesson.id), title: String(lesson.title), dueAt: (lesson.due_at as string) ?? null },
    role: a.role,
    isLeader: !!a.m?.isLeader,
    deadlinePassed: passed,
    lateAllowed: late,
    canEdit,
    my,
    peers: [],
  };
  // 同組已送出（學員、組長）
  if (a.m?.groupId && !a.teacher) {
    const rows = (
      await db
        .prepare("SELECT s.id, s.member_id FROM submissions s JOIN members m ON m.activity_id = s.activity_id AND m.member_id = s.member_id WHERE s.item_id = ? AND m.group_id = ? AND s.member_id != ? AND s.status != 'draft' ORDER BY s.submitted_at")
        .bind(itemId, a.m.groupId, c.sub)
        .all<Row>()
    ).results;
    const nm = await names(db, rows.map((r) => String(r.member_id)));
    for (const r of rows) {
      const fs = (await db.prepare("SELECT kind FROM files WHERE submission_id = ?").bind(r.id).all<Row>()).results;
      view.peers.push({ submissionId: String(r.id), memberId: String(r.member_id), name: nameOr(nm, String(r.member_id)), files: fs.length, kinds: [...new Set(fs.map((f) => f.kind as Kind))] });
    }
  }
  // 名單（老師：全部；組長：自己這組）
  if (a.teacher || a.m?.isLeader) {
    const ms = (
      await db
        .prepare(`SELECT m.member_id, m.group_id, g.name AS gname FROM members m LEFT JOIN groups g ON g.id = m.group_id WHERE m.activity_id = ? AND m.role = 'student' AND m.status = 'active' ${a.teacher ? "" : "AND m.group_id = ?"} ORDER BY g.position, m.joined_at`)
        .bind(...(a.teacher ? [a.activity.id] : [a.activity.id, a.m!.groupId]))
        .all<Row>()
    ).results;
    const subs = new Map((await db.prepare("SELECT * FROM submissions WHERE item_id = ?").bind(itemId).all<Row>()).results.map((s) => [String(s.member_id), s]));
    const nm = await names(db, ms.map((m) => String(m.member_id)));
    view.roster = ms.map((m) => {
      const s = subs.get(String(m.member_id));
      return {
        memberId: String(m.member_id),
        name: nameOr(nm, String(m.member_id)),
        groupName: (m.gname as string) ?? null,
        status: (s?.status as SubStatus) ?? "none",
        submissionId: s ? String(s.id) : null,
        points: s?.status === "graded" ? num(s.points) : null,
        late: !!s?.late,
      };
    });
  }
  return view;
}

/** 讀一份繳交（老師全部、組長自己這組、同組組員只能看已送出且預設看不到分數、本人）。 */
export async function canSeeSubmission(c: Ctx, s: Row): Promise<{ a: Access; hideScores: boolean; leaderOfIt: boolean }> {
  const a = await access(c, String(s.activity_id));
  needActive(a);
  if (a.teacher || s.member_id === c.sub) return { a, hideScores: false, leaderOfIt: false };
  const owner = await membership(c.env.DB, String(s.activity_id), String(s.member_id));
  const sameGroup = !!a.m?.groupId && owner?.groupId === a.m.groupId;
  if (!sameGroup || s.status === "draft") fail(403, "你沒有權限看這份作業");
  if (a.m?.isLeader) return { a, hideScores: false, leaderOfIt: true };
  return { a, hideScores: !a.activity.peers_see_scores, leaderOfIt: false };
}

export async function mySubmission(c: Ctx, item: Row): Promise<Row> {
  const db = c.env.DB;
  let s = await db.prepare("SELECT * FROM submissions WHERE item_id = ? AND member_id = ?").bind(item.id, c.sub).first<Row>();
  if (!s) {
    await db.prepare("INSERT INTO submissions (id, item_id, activity_id, member_id) VALUES (?, ?, ?, ?)").bind(rid(), item.id, item.activity_id, c.sub).run();
    s = (await db.prepare("SELECT * FROM submissions WHERE item_id = ? AND member_id = ?").bind(item.id, c.sub).first<Row>())!;
  }
  return s;
}
export async function editableSubmission(c: Ctx, itemId: string) {
  const v = await loadItem(c, itemId);
  needActive(v.a);
  if (v.a.teacher) fail(403, "老師不用交作業");
  if (v.item.mode === "onsite") fail(400, "這一項由老師現場登錄，不需要上傳");
  if (v.a.activity.files_purged_at) fail(400, "這份作業的檔案已刪除，不能再繳交");
  if (v.a.activity.status === "closed") fail(400, "這份作業已結束");
  if (deadlinePassed(v.lesson.due_at) && !lateOk(v.item, v.a.activity)) fail(400, "已經截止，這一項不開放補交");
  const s = await mySubmission(c, v.item);
  if (!["draft", "returned"].includes(String(s.status))) fail(400, s.status === "graded" ? "老師已評分，不能再修改" : "已經送出，要修改請先按「收回修改」");
  return { ...v, s };
}

export function sniff(kind: Kind, bytes: Uint8Array, name: string, type: string): { ok: boolean; contentType: string } {
  const b = bytes;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const isJpeg = b[0] === 0xff && b[1] === 0xd8;
  const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const isWebp = b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  const isHeic = b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && ["heic", "heif"].includes(ext);
  const isMp4 = b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
  if (kind === "photo") {
    if (isJpeg) return { ok: true, contentType: "image/jpeg" };
    if (isPng) return { ok: true, contentType: "image/png" };
    if (isWebp) return { ok: true, contentType: "image/webp" };
    if (isHeic) return { ok: true, contentType: "image/heic" };
    return { ok: false, contentType: "" };
  }
  if (kind === "video") {
    if (isMp4) return { ok: true, contentType: ext === "mov" ? "video/quicktime" : "video/mp4" };
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ok: true, contentType: "video/webm" };
    return { ok: false, contentType: "" };
  }
  // 檔案：PDF、Office、文字檔；影片不收（要用短影片）
  if (isMp4 || ["mp4", "mov", "m4v", "avi", "mkv", "webm"].includes(ext)) return { ok: false, contentType: "" };
  const map: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain; charset=utf-8",
    key: "application/octet-stream",
    pages: "application/octet-stream",
    numbers: "application/octet-stream",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
  };
  if (!map[ext]) return { ok: false, contentType: "" };
  return { ok: true, contentType: map[ext] || type || "application/octet-stream" };
}

export async function countEntries(db: D1Database, submissionId: unknown): Promise<number> {
  return Number((await db.prepare("SELECT COUNT(*) AS n FROM files WHERE submission_id = ?").bind(submissionId).first<Row>())?.n ?? 0);
}

export async function deleteR2(env: Env, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 500) {
    const part = keys.slice(i, i + 500);
    try {
      await env.FILES.delete(part);
    } catch {
      try {
        await env.FILES.delete(part);
      } catch (e) {
        console.error("r2_delete_failed", part.length, String(e).slice(0, 100));
      }
    }
  }
}

// ───────────── 人員與分組 ─────────────
export async function people(c: Ctx, activityId: string): Promise<PeopleView> {
  const a = await access(c, activityId);
  needActive(a);
  const db = c.env.DB;
  const leaderGroup = !a.teacher && a.m?.isLeader ? a.m.groupId : null;
  const groups = (await db.prepare("SELECT * FROM groups WHERE activity_id = ? ORDER BY position, created_at").bind(activityId).all<Row>()).results;
  const ms = (await db.prepare("SELECT * FROM members WHERE activity_id = ? AND status != 'removed' ORDER BY joined_at").bind(activityId).all<Row>()).results;
  const nm = await names(db, ms.map((m) => String(m.member_id)));
  const totals = new Map<string, number>();
  if (a.teacher || leaderGroup) {
    const t = (
      await db
        .prepare("SELECT s.member_id, SUM(s.points) AS t FROM submissions s JOIN items i ON i.id = s.item_id WHERE s.activity_id = ? AND s.status = 'graded' AND i.in_total = 1 GROUP BY s.member_id")
        .bind(activityId)
        .all<Row>()
    ).results;
    for (const r of t) totals.set(String(r.member_id), Math.round(Number(r.t) * 10) / 10);
  }
  const person = (m: Row): Person => ({
    memberId: String(m.member_id),
    name: nameOr(nm, String(m.member_id)),
    avatarUrl: nm.get(String(m.member_id))?.avatarUrl ?? null,
    role: m.role as Role,
    status: m.status === "pending" ? "pending" : "active",
    groupId: (m.group_id as string) ?? null,
    isLeader: !!m.is_leader,
    total: m.role === "student" && (a.teacher || (leaderGroup && m.group_id === leaderGroup)) ? (totals.get(String(m.member_id)) ?? 0) : null,
  });
  const students = ms.filter((m) => m.role === "student" && m.status === "active");
  const visibleGroups = a.teacher ? groups : groups.filter((g) => g.id === a.m?.groupId);
  const gv: GroupView[] = visibleGroups.map((g) => ({
    id: String(g.id),
    name: String(g.name),
    joinCode: a.teacher || g.id === leaderGroup ? String(g.join_code) : null,
    members: students.filter((m) => m.group_id === g.id).map(person),
  }));
  return {
    canManage: a.manager,
    canEditGroupId: a.teacher ? null : leaderGroup,
    groups: gv,
    unassigned: a.teacher || leaderGroup ? students.filter((m) => !m.group_id).map(person) : [],
    // 組長也看得到「用本組連結申請加入」的人，可以自己核准（杜杜龍 2026-11-27）
    pending: a.manager ? ms.filter((m) => m.status === "pending").map(person) : leaderGroup ? ms.filter((m) => m.status === "pending" && m.group_id === leaderGroup).map(person) : [],
    staff: a.teacher ? ms.filter((m) => m.role !== "student" && m.status === "active").map(person) : [],
  };
}

export async function personAction(c: Ctx, activityId: string, memberId: string, body: Row): Promise<void> {
  const a = await access(c, activityId);
  needActive(a);
  const db = c.env.DB;
  const target = await db.prepare("SELECT * FROM members WHERE activity_id = ? AND member_id = ?").bind(activityId, memberId).first<Row>();
  if (!target || target.status === "removed") fail(404, "找不到這位成員");
  const action = str(body.action, 20);
  const leaderGroup = !a.teacher && a.m?.isLeader ? a.m.groupId : null;
  const title = String(a.activity.title);
  switch (action) {
    case "approve":
      if (!(a.manager || (leaderGroup && target!.status === "pending" && target!.group_id === leaderGroup))) fail(403, "只有管理員或本組組長可以核准");
      await db.prepare("UPDATE members SET status = 'active' WHERE activity_id = ? AND member_id = ?").bind(activityId, memberId).run();
      await notify(db, [memberId], "已加入作業", `你已加入「${title}」，可以開始交作業了。`, `/activity/${activityId}`);
      return;
    case "reject":
      if (!(a.manager || (leaderGroup && target!.status === "pending" && target!.group_id === leaderGroup))) fail(403, "只有管理員或本組組長可以拒絕");
      await db.prepare("UPDATE members SET status = 'removed', group_id = NULL, is_leader = 0 WHERE activity_id = ? AND member_id = ?").bind(activityId, memberId).run();
      return;
    case "remove":
      needManager(a);
      if (memberId === c.sub) fail(400, "不能移除自己");
      await db.prepare("UPDATE members SET status = 'removed', group_id = NULL, is_leader = 0 WHERE activity_id = ? AND member_id = ?").bind(activityId, memberId).run();
      return;
    case "role": {
      needManager(a);
      const role = str(body.role, 10);
      if (!["student", "teacher", "manager"].includes(role)) fail(400, "身分不正確");
      if (memberId === c.sub && role !== "manager" && !(await superAdmin(c))) fail(400, "不能把自己的管理員身分拿掉");
      await db.prepare("UPDATE members SET role = ?, group_id = CASE WHEN ? = 'student' THEN group_id ELSE NULL END, is_leader = CASE WHEN ? = 'student' THEN is_leader ELSE 0 END WHERE activity_id = ? AND member_id = ?").bind(role, role, role, activityId, memberId).run();
      return;
    }
    case "group": {
      const groupId = str(body.groupId, 40) || null;
      if (target!.role !== "student") fail(400, "只有學員能分組");
      if (groupId) {
        const g = await db.prepare("SELECT id FROM groups WHERE id = ? AND activity_id = ?").bind(groupId, activityId).first<Row>();
        if (!g) fail(404, "找不到這一組");
      }
      if (!a.teacher) {
        // 組長：只能把「還沒分組」的人拉進自己這組，或把自己組的人移出
        if (!leaderGroup) fail(403, "只有老師或組長可以分組");
        const pullIn = !target!.group_id && groupId === leaderGroup;
        const moveOut = target!.group_id === leaderGroup && groupId === null && memberId !== c.sub;
        if (!pullIn && !moveOut) fail(403, "組長只能把還沒分組的人拉進本組，或把組員移出");
      }
      await db.prepare("UPDATE members SET group_id = ?, is_leader = 0 WHERE activity_id = ? AND member_id = ?").bind(groupId, activityId, memberId).run();
      return;
    }
    case "leader": {
      needTeacher(a);
      if (!target!.group_id) fail(400, "請先把他分到某一組");
      await db.batch([
        db.prepare("UPDATE members SET is_leader = 0 WHERE activity_id = ? AND group_id = ?").bind(activityId, target!.group_id),
        db.prepare("UPDATE members SET is_leader = 1 WHERE activity_id = ? AND member_id = ?").bind(activityId, memberId),
      ]);
      await notify(db, [memberId], "你被指定為組長", `「${title}」：你可以確認或退回組員的作業。`, `/activity/${activityId}`);
      return;
    }
    default:
      fail(400, "不認得的動作");
  }
}

// ───────────── 批改 ─────────────
export async function queue(c: Ctx, activityId: string): Promise<QueueEntry[]> {
  const a = await access(c, activityId);
  needActive(a);
  const db = c.env.DB;
  let rows: Row[];
  if (a.teacher) {
    rows = (await db.prepare("SELECT s.* FROM submissions s WHERE s.activity_id = ? AND s.status IN ('submitted','leader_ok') ORDER BY s.submitted_at").bind(activityId).all<Row>()).results;
  } else if (a.m?.isLeader && a.m.groupId) {
    rows = (
      await db
        .prepare("SELECT s.* FROM submissions s JOIN members m ON m.activity_id = s.activity_id AND m.member_id = s.member_id WHERE s.activity_id = ? AND m.group_id = ? AND s.member_id != ? AND s.status = 'submitted' ORDER BY s.submitted_at")
        .bind(activityId, a.m.groupId, c.sub)
        .all<Row>()
    ).results;
  } else return [];
  const items = new Map((await db.prepare("SELECT * FROM items WHERE activity_id = ?").bind(activityId).all<Row>()).results.map((r) => [String(r.id), r]));
  const lessons = new Map((await db.prepare("SELECT id, title FROM lessons WHERE activity_id = ?").bind(activityId).all<Row>()).results.map((r) => [String(r.id), String(r.title)]));
  const groupOf = new Map((await db.prepare("SELECT m.member_id, g.name FROM members m LEFT JOIN groups g ON g.id = m.group_id WHERE m.activity_id = ?").bind(activityId).all<Row>()).results.map((r) => [String(r.member_id), (r.name as string) ?? null]));
  const out: QueueEntry[] = [];
  for (const s of rows) {
    const it = items.get(String(s.item_id));
    if (!it) continue;
    out.push({ submission: await submissionView(c, s, { hideScores: false, withComments: true }), item: itemCard(it), lessonTitle: lessons.get(String(it.lesson_id)) ?? "", groupName: groupOf.get(String(s.member_id)) ?? null });
  }
  return out;
}

export async function grade(c: Ctx, submissionId: string, body: Row): Promise<void> {
  const db = c.env.DB;
  const s = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(submissionId).first<Row>();
  if (!s) fail(404, "找不到這份作業");
  const a = await access(c, String(s!.activity_id));
  needTeacher(a);
  const item = (await db.prepare("SELECT * FROM items WHERE id = ?").bind(s!.item_id).first<Row>())!;
  const card = itemCard(item);
  if (s!.status === "draft") fail(400, "學員還沒送出");
  const g = { approved: num(body.approved), score: num(body.score), stars: num(body.stars) };
  if (card.mode === "count" && (g.approved == null || g.approved < 0 || g.approved > 1000)) fail(400, `請填核定的${card.unit}數`);
  if ((card.mode === "score" || card.mode === "onsite") && (g.score == null || g.score < 0 || g.score > (card.fullScore ?? 100))) fail(400, `分數要在 0～${card.fullScore ?? 100}`);
  if (card.mode === "stars" && (g.stars == null || g.stars < 1 || g.stars > 5)) fail(400, "請給 1～5 顆星");
  const points = pointsFor(card, g);
  await db
    .prepare("UPDATE submissions SET status = 'graded', approved = ?, score = ?, stars = ?, points = ?, comment = ?, graded_by = ?, graded_at = ?, updated_at = ? WHERE id = ?")
    .bind(card.mode === "count" ? Math.round(g.approved!) : null, g.score, g.stars, points, str(body.comment, 1000), c.sub, now(), now(), submissionId)
    .run();
  await notify(db, [String(s!.member_id)], "老師已評分", `「${card.name}」得 ${points} 分。`, `/item/${card.id}`);
}

export async function returnSubmission(c: Ctx, submissionId: string, body: Row): Promise<void> {
  const db = c.env.DB;
  const s = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(submissionId).first<Row>();
  if (!s) fail(404, "找不到這份作業");
  const see = await canSeeSubmission(c, s!);
  if (!see.a.teacher && !see.leaderOfIt) fail(403, "只有老師或組長可以退回");
  if (!see.a.teacher && s!.status !== "submitted") fail(400, "這份作業已不在等你確認");
  if (!["submitted", "leader_ok", "graded"].includes(String(s!.status))) fail(400, "這份作業還沒送出");
  const comment = str(body.comment, 1000);
  if (!comment) fail(400, "退回時請寫原因，讓學員知道要改哪裡");
  const item = (await db.prepare("SELECT name, id FROM items WHERE id = ?").bind(s!.item_id).first<Row>())!;
  if (see.a.teacher)
    await db.prepare("UPDATE submissions SET status = 'returned', comment = ?, points = NULL, graded_by = ?, graded_at = NULL, updated_at = ? WHERE id = ?").bind(comment, c.sub, now(), submissionId).run();
  else await db.prepare("UPDATE submissions SET status = 'returned', leader_note = ?, updated_at = ? WHERE id = ?").bind(comment, now(), submissionId).run();
  await notify(db, [String(s!.member_id)], "作業被退回重交", `「${item.name}」：${comment}`, `/item/${item.id}`);
}

// ───────────── 路由 ─────────────
export type Handler = (c: Ctx, p: string[], req: Request) => Promise<unknown>;
export const body = async (req: Request): Promise<Row> => {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Row) : {};
  } catch {
    return {};
  }
};

export function dueAt(v: unknown): string | null {
  const s = str(v, 40);
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) fail(400, "截止時間格式不正確");
  return new Date(t).toISOString();
}

export const routes: [string, RegExp, Handler][] = [];
export const on = (method: string, path: string, h: Handler) => routes.push([method, new RegExp("^" + path.replace(/:\w+/g, "([^/]+)") + "$"), h]);
