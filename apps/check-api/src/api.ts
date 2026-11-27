/**
 * 寰宇繳作業系統 API（/api/…）。每個請求都在這裡驗證身分與權限；前端隱藏按鈕不算權限控制。
 * 權限：
 * - 活動管理員＝中央超級管理員，或在這個活動被設為 manager 的人。
 * - 老師＝活動管理員，或在這個活動被設為 teacher 的人。只有老師能評分。
 * - 組長：看自己這組全部（含分數）、確認或退回組員作業、留言、編自己這組；不能評分、不能指定組長。
 * - 學員：交自己的作業；看同組已送出的作業（分數預設看不到）。
 */
import { isSuperAdmin, ownProfile, verifyAccessToken, verifyWebhook, forgetMember, INTEGRATED_VERSION } from "./central.ts";
import {
  DEFAULT_KINDS,
  KINDS,
  LIMITS,
  pointsFor,
  type ActivityCard,
  type ActivitySettings,
  type ActivityView,
  type CommentView,
  type FileView,
  type GroupView,
  type ItemCard,
  type ItemMode,
  type ItemView,
  type Kind,
  type Me,
  type Notice,
  type PeopleView,
  type Person,
  type QueueEntry,
  type Role,
  type SubmissionView,
  type SubStatus,
} from "./contract.ts";
import type { D1Database, Env } from "./env.ts";
import { DEFAULT_SHARED_UPLOAD, readSharedUpload, writeSharedUpload } from "../../../packages/server-shared/src/upload-settings.ts";
import { sendPush, vapidPublicKey } from "../../../packages/server-shared/src/web-push.ts";

export const API_VERSION = "0.1.0";

type Row = Record<string, unknown>;
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const rid = (n = 12) => {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => a[x % a.length]).join("");
};
const now = () => new Date().toISOString();
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const bool = (v: unknown) => v === true || v === 1 || v === "1";

type Ctx = { env: Env; sub: string; token: string; bg: (p: Promise<unknown>) => void; superAdmin?: boolean };

async function authenticate(req: Request, env: Env): Promise<{ sub: string; token: string } | null> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) return null;
  if (env.DEV_LOGIN === "on" && token.startsWith("dev:")) return { sub: token.slice(4, 60), token };
  const sub = await verifyAccessToken(token);
  return sub ? { sub, token } : null;
}
async function superAdmin(c: Ctx): Promise<boolean> {
  if (c.superAdmin === undefined) {
    if (c.env.DEV_LOGIN === "on" && c.token.startsWith("dev:")) c.superAdmin = c.sub.startsWith("admin");
    else c.superAdmin = await isSuperAdmin(c.sub, c.token);
  }
  return c.superAdmin;
}

/** 顯示名稱的必要副本：本人每次使用時（最多 10 分鐘一次）從中央讀取更新。 */
async function refreshPerson(c: Ctx): Promise<void> {
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
type Membership = { role: Role; status: string; groupId: string | null; isLeader: boolean } | null;
async function membership(db: D1Database, activityId: string, sub: string): Promise<Membership> {
  const r = await db.prepare("SELECT role, status, group_id, is_leader FROM members WHERE activity_id = ? AND member_id = ?").bind(activityId, sub).first<Row>();
  if (!r || r.status === "removed") return null;
  return { role: r.role as Role, status: String(r.status), groupId: (r.group_id as string) ?? null, isLeader: !!r.is_leader };
}
type Access = { activity: Row; m: Membership; role: Role; manager: boolean; teacher: boolean; active: boolean };
async function access(c: Ctx, activityId: string): Promise<Access> {
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
const needActive = (a: Access) => {
  if (!a.active) fail(403, "等待管理員核准加入");
};
const needTeacher = (a: Access) => {
  if (!a.teacher) fail(403, "只有老師可以做這件事");
};
const needManager = (a: Access) => {
  if (!a.manager) fail(403, "只有管理員可以做這件事");
};

// ───────────── 資料轉換 ─────────────
function itemCard(r: Row): ItemCard {
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
function settings(a: Row): ActivitySettings {
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
    retentionUntil: (a.retention_until as string) ?? null,
    filesPurgedAt: (a.files_purged_at as string) ?? null,
  };
}
async function names(db: D1Database, ids: string[]): Promise<Map<string, { name: string; avatarUrl: string | null }>> {
  const out = new Map<string, { name: string; avatarUrl: string | null }>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 90) {
    const part = uniq.slice(i, i + 90);
    const rs = await db.prepare(`SELECT member_id, display_name, avatar_url FROM people WHERE member_id IN (${part.map(() => "?").join(",")})`).bind(...part).all<Row>();
    for (const r of rs.results) out.set(String(r.member_id), { name: String(r.display_name || ""), avatarUrl: (r.avatar_url as string) ?? null });
  }
  return out;
}
const nameOr = (m: Map<string, { name: string }>, id: string) => m.get(id)?.name || "學員";

function fileView(r: Row): FileView {
  const f: FileView = { id: String(r.id), kind: r.kind as Kind, name: String(r.name ?? ""), size: Number(r.size ?? 0), contentType: String(r.content_type ?? "") };
  if (r.kind === "link") f.url = String(r.url ?? "");
  if (r.kind === "text") f.body = String(r.body ?? "");
  return f;
}
const ROLE_LABEL: Record<string, string> = { student: "學員", teacher: "老師", manager: "管理員", leader: "組長" };

async function submissionView(c: Ctx, s: Row, opts: { hideScores: boolean; withComments: boolean }): Promise<SubmissionView> {
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

async function totalOf(db: D1Database, activityId: string, sub: string): Promise<number> {
  const r = await db
    .prepare("SELECT COALESCE(SUM(s.points), 0) AS t FROM submissions s JOIN items i ON i.id = s.item_id WHERE s.activity_id = ? AND s.member_id = ? AND s.status = 'graded' AND i.in_total = 1")
    .bind(activityId, sub)
    .first<Row>();
  return Math.round(Number(r?.t ?? 0) * 10) / 10;
}

async function notify(db: D1Database, memberIds: string[], title: string, body: string, link: string): Promise<void> {
  const ids = [...new Set(memberIds)].filter(Boolean);
  if (!ids.length) return;
  await db.batch(ids.map((m) => db.prepare("INSERT INTO notices (id, member_id, title, body, link) VALUES (?, ?, ?, ?, ?)").bind(rid(), m, title.slice(0, 80), body.slice(0, 300), link)));
  pushSoon?.();
}
/** 每個請求開始時設定：站內通知新增後，在背景把它推到手機（handleApi 設定；排程另外每小時補推一次）。 */
let pushSoon: (() => void) | null = null;

const PUSH_SUBJECT = "https://check.hglobal1985.com";
/** 把最近 30 分鐘內還沒推播的站內通知推出去（先標記再推：寧可漏推也不重複推）。回傳推出去的則數。 */
export async function flushPushes(env: Env, fetcher: typeof fetch = fetch): Promise<number> {
  if (!vapidPublicKey(env.VAPID_PRIVATE_JWK)) return 0;
  const db = env.DB;
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  const rows = (await db.prepare("SELECT id, member_id, title, body, link FROM notices WHERE pushed = 0 AND created_at >= ? ORDER BY created_at LIMIT 50").bind(since).all<Row>()).results;
  let sent = 0;
  for (const n of rows) {
    const claim = await db.prepare("UPDATE notices SET pushed = 1 WHERE id = ? AND pushed = 0").bind(n.id).run();
    if (!claim.meta?.changes) continue;
    const subs = (await db.prepare("SELECT endpoint, p256dh, auth FROM push_subs WHERE member_id = ?").bind(n.member_id).all<{ endpoint: string; p256dh: string; auth: string }>()).results;
    for (const d of subs) {
      const r = await sendPush(env.VAPID_PRIVATE_JWK, PUSH_SUBJECT, d, { title: String(n.title), body: String(n.body), link: String(n.link || "/notices") }, fetcher);
      if (r === "ok") sent++;
      else if (r === "gone") await db.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(d.endpoint).run();
      else await db.prepare("UPDATE push_subs SET failures = failures + 1 WHERE endpoint = ?").bind(d.endpoint).run();
    }
  }
  await db.prepare("DELETE FROM push_subs WHERE failures >= 20").run();
  return sent;
}

const deadlinePassed = (dueAt: unknown) => typeof dueAt === "string" && dueAt !== "" && Date.parse(dueAt) < Date.now();
const lateOk = (item: Row, activity: Row) => (item.late_allowed == null ? !!activity.late_allowed : !!item.late_allowed);

// ───────────── 首頁 ─────────────
async function home(c: Ctx): Promise<ActivityCard[]> {
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
async function activityView(c: Ctx, id: string): Promise<ActivityView> {
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

async function loadItem(c: Ctx, itemId: string) {
  const item = await c.env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(itemId).first<Row>();
  if (!item) fail(404, "找不到這個作業項目");
  const lesson = (await c.env.DB.prepare("SELECT * FROM lessons WHERE id = ?").bind(item!.lesson_id).first<Row>())!;
  const a = await access(c, String(item!.activity_id));
  return { item: item!, lesson, a };
}

async function itemView(c: Ctx, itemId: string): Promise<ItemView> {
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
async function canSeeSubmission(c: Ctx, s: Row): Promise<{ a: Access; hideScores: boolean; leaderOfIt: boolean }> {
  const a = await access(c, String(s.activity_id));
  needActive(a);
  if (a.teacher || s.member_id === c.sub) return { a, hideScores: false, leaderOfIt: false };
  const owner = await membership(c.env.DB, String(s.activity_id), String(s.member_id));
  const sameGroup = !!a.m?.groupId && owner?.groupId === a.m.groupId;
  if (!sameGroup || s.status === "draft") fail(403, "你沒有權限看這份作業");
  if (a.m?.isLeader) return { a, hideScores: false, leaderOfIt: true };
  return { a, hideScores: !a.activity.peers_see_scores, leaderOfIt: false };
}

async function mySubmission(c: Ctx, item: Row): Promise<Row> {
  const db = c.env.DB;
  let s = await db.prepare("SELECT * FROM submissions WHERE item_id = ? AND member_id = ?").bind(item.id, c.sub).first<Row>();
  if (!s) {
    await db.prepare("INSERT INTO submissions (id, item_id, activity_id, member_id) VALUES (?, ?, ?, ?)").bind(rid(), item.id, item.activity_id, c.sub).run();
    s = (await db.prepare("SELECT * FROM submissions WHERE item_id = ? AND member_id = ?").bind(item.id, c.sub).first<Row>())!;
  }
  return s;
}
async function editableSubmission(c: Ctx, itemId: string) {
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

function sniff(kind: Kind, bytes: Uint8Array, name: string, type: string): { ok: boolean; contentType: string } {
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

async function countEntries(db: D1Database, submissionId: unknown): Promise<number> {
  return Number((await db.prepare("SELECT COUNT(*) AS n FROM files WHERE submission_id = ?").bind(submissionId).first<Row>())?.n ?? 0);
}

async function deleteR2(env: Env, keys: string[]): Promise<void> {
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
async function people(c: Ctx, activityId: string): Promise<PeopleView> {
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
    pending: a.manager ? ms.filter((m) => m.status === "pending").map(person) : [],
    staff: a.teacher ? ms.filter((m) => m.role !== "student" && m.status === "active").map(person) : [],
  };
}

async function personAction(c: Ctx, activityId: string, memberId: string, body: Row): Promise<void> {
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
      needManager(a);
      await db.prepare("UPDATE members SET status = 'active' WHERE activity_id = ? AND member_id = ?").bind(activityId, memberId).run();
      await notify(db, [memberId], "已加入作業", `你已加入「${title}」，可以開始交作業了。`, `/activity/${activityId}`);
      return;
    case "reject":
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
async function queue(c: Ctx, activityId: string): Promise<QueueEntry[]> {
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

async function grade(c: Ctx, submissionId: string, body: Row): Promise<void> {
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

async function returnSubmission(c: Ctx, submissionId: string, body: Row): Promise<void> {
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
type Handler = (c: Ctx, p: string[], req: Request) => Promise<unknown>;
const routes: [string, RegExp, Handler][] = [];
const on = (method: string, path: string, h: Handler) => routes.push([method, new RegExp("^" + path.replace(/:\w+/g, "([^/]+)") + "$"), h]);
const body = async (req: Request): Promise<Row> => {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Row) : {};
  } catch {
    return {};
  }
};

on("GET", "/me", async (c) => {
  const p = await c.env.DB.prepare("SELECT display_name, avatar_url FROM people WHERE member_id = ?").bind(c.sub).first<Row>();
  const unread = Number((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM notices WHERE member_id = ? AND read_at IS NULL").bind(c.sub).first<Row>())?.n ?? 0);
  const sa = await superAdmin(c);
  const cards = await home(c);
  const staff = sa || cards.some((a) => a.role !== "student" || a.isLeader);
  const toReview = cards.reduce((n, a) => n + a.toReview, 0);
  const me: Me = { memberId: c.sub, name: String(p?.display_name || ""), avatarUrl: (p?.avatar_url as string) ?? null, superAdmin: sa, unread, staff, toReview };
  return me;
});
on("GET", "/home", async (c) => home(c));

// 手機推播（網頁版；共用的開關模組 packages/ui/src/lib/web-push.ts 用同樣的網址）
on("GET", "/push/key", async (c) => ({ publicKey: vapidPublicKey(c.env.VAPID_PRIVATE_JWK) }));
on("POST", "/push/subscribe", async (c, _p, req) => {
  const b = await body(req);
  const keys = (b.keys ?? {}) as Row;
  const endpoint = str(b.endpoint, 1000);
  if (!/^https:\/\//.test(endpoint) || !str(keys.p256dh, 200) || !str(keys.auth, 100)) fail(400, "推播訂閱格式不正確");
  await c.env.DB.prepare("INSERT INTO push_subs (endpoint, member_id, p256dh, auth) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth, failures = 0")
    .bind(endpoint, c.sub, str(keys.p256dh, 200), str(keys.auth, 100))
    .run();
  return { ok: true };
});
on("POST", "/push/unsubscribe", async (c, _p, req) => {
  await c.env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ? AND member_id = ?").bind(str((await body(req)).endpoint, 1000), c.sub).run();
  return { ok: true };
});

// 上傳壓縮設定：與行動大學共用同一份（Cloudflare KV；杜杜龍 2026-11-26）。任一邊改，另一邊自動跟上。
on("GET", "/upload-settings", async (c) => ({ settings: (await readSharedUpload(c.env.SHARED)) ?? DEFAULT_SHARED_UPLOAD, shared: !!c.env.SHARED, canEdit: await superAdmin(c) }));
on("PUT", "/upload-settings", async (c, _p, req) => {
  if (!(await superAdmin(c))) fail(403, "只有超級管理員可以修改上傳設定");
  if (!c.env.SHARED) fail(503, "共用設定儲存區尚未設定");
  return { settings: await writeSharedUpload(c.env.SHARED, await body(req)) };
});

on("POST", "/activities", async (c, _p, req) => {
  if (!(await superAdmin(c))) fail(403, "只有超級管理員可以新增作業");
  const b = await body(req);
  const title = str(b.title, 60);
  if (!title) fail(400, "請填作業名稱");
  const id = rid(10);
  const db = c.env.DB;
  await db.batch([
    db.prepare("INSERT INTO activities (id, title, summary, starts_on, ends_on, join_code, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, title, str(b.summary, 500), str(b.startsOn, 10) || null, str(b.endsOn, 10) || null, rid(8), c.sub),
    db.prepare("INSERT INTO members (activity_id, member_id, role, status) VALUES (?, ?, 'manager', 'active')").bind(id, c.sub),
  ]);
  return { id };
});
on("GET", "/activities/:id", async (c, [id]) => activityView(c, id));
on("PATCH", "/activities/:id", async (c, [id], req) => {
  const a = await access(c, id);
  needManager(a);
  const b = await body(req);
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  if ("title" in b) set("title", str(b.title, 60) || fail(400, "請填作業名稱"));
  if ("summary" in b) set("summary", str(b.summary, 500));
  if ("startsOn" in b) set("starts_on", str(b.startsOn, 10) || null);
  if ("endsOn" in b) set("ends_on", str(b.endsOn, 10) || null);
  if ("status" in b) {
    const st = str(b.status, 10);
    if (!["draft", "open", "closed"].includes(st)) fail(400, "狀態不正確");
    set("status", st);
  }
  if ("joinApproval" in b) set("join_approval", bool(b.joinApproval) ? 1 : 0);
  if ("lateAllowed" in b) set("late_allowed", bool(b.lateAllowed) ? 1 : 0);
  if ("autoRemind" in b) set("auto_remind", bool(b.autoRemind) ? 1 : 0);
  if ("peersSeeScores" in b) set("peers_see_scores", bool(b.peersSeeScores) ? 1 : 0);
  if ("retentionUntil" in b) {
    const d = str(b.retentionUntil, 10);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) fail(400, "日期格式不正確");
    set("retention_until", d || null);
  }
  if (!sets.length) return { ok: true };
  set("updated_at", now());
  await c.env.DB.prepare(`UPDATE activities SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  if (b.status === "open" && a.activity.status === "draft") {
    const ids = (await c.env.DB.prepare("SELECT member_id FROM members WHERE activity_id = ? AND role = 'student' AND status = 'active'").bind(id).all<Row>()).results.map((r) => String(r.member_id));
    await notify(c.env.DB, ids, "作業開放了", `「${a.activity.title}」已開放繳交。`, `/activity/${id}`);
  }
  return { ok: true };
});
on("POST", "/activities/:id/join-code", async (c, [id]) => {
  needManager(await access(c, id));
  const code = rid(8);
  await c.env.DB.prepare("UPDATE activities SET join_code = ? WHERE id = ?").bind(code, id).run();
  return { joinCode: code };
});

// 堂與項目
on("POST", "/activities/:id/lessons", async (c, [id], req) => {
  needManager(await access(c, id));
  const b = await body(req);
  const max = Number((await c.env.DB.prepare("SELECT COALESCE(MAX(position), 0) AS p FROM lessons WHERE activity_id = ?").bind(id).first<Row>())?.p ?? 0);
  const lid = rid();
  await c.env.DB.prepare("INSERT INTO lessons (id, activity_id, position, title, due_at) VALUES (?, ?, ?, ?, ?)").bind(lid, id, max + 1, str(b.title, 40) || `第 ${max + 1} 堂`, dueAt(b.dueAt)).run();
  return { id: lid };
});
function dueAt(v: unknown): string | null {
  const s = str(v, 40);
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) fail(400, "截止時間格式不正確");
  return new Date(t).toISOString();
}
on("PATCH", "/lessons/:id", async (c, [id], req) => {
  const l = await c.env.DB.prepare("SELECT * FROM lessons WHERE id = ?").bind(id).first<Row>();
  if (!l) fail(404, "找不到這一堂");
  needManager(await access(c, String(l!.activity_id)));
  const b = await body(req);
  await c.env.DB.prepare("UPDATE lessons SET title = ?, due_at = ? WHERE id = ?").bind("title" in b ? str(b.title, 40) || l!.title : l!.title, "dueAt" in b ? dueAt(b.dueAt) : l!.due_at, id).run();
  if ("dueAt" in b) await c.env.DB.prepare("DELETE FROM reminders_sent WHERE lesson_id = ?").bind(id).run();
  return { ok: true };
});
on("DELETE", "/lessons/:id", async (c, [id]) => {
  const l = await c.env.DB.prepare("SELECT * FROM lessons WHERE id = ?").bind(id).first<Row>();
  if (!l) fail(404, "找不到這一堂");
  needManager(await access(c, String(l!.activity_id)));
  const used = await c.env.DB.prepare("SELECT 1 FROM submissions s JOIN items i ON i.id = s.item_id WHERE i.lesson_id = ? LIMIT 1").bind(id).first();
  if (used) fail(400, "這一堂已經有人交作業，不能刪除");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM items WHERE lesson_id = ?").bind(id), c.env.DB.prepare("DELETE FROM lessons WHERE id = ?").bind(id)]);
  return { ok: true };
});

function itemFields(b: Row, base?: Row): Row {
  const mode = (("mode" in b ? str(b.mode, 10) : base?.mode) as ItemMode) ?? "count";
  if (!["count", "fixed", "pass", "score", "stars", "onsite"].includes(mode)) fail(400, "計分方式不正確");
  const pick = (k: string, col: string) => (k in b ? num(b[k]) : base ? num(base[col]) : null);
  const kindsIn = "kinds" in b && Array.isArray(b.kinds) ? (b.kinds as unknown[]).map(String).filter((k) => k in KINDS) : null;
  const kinds = mode === "onsite" ? [] : (kindsIn ?? (base ? String(base.kinds).split(",").filter(Boolean) : DEFAULT_KINDS[mode]));
  if (mode !== "onsite" && !kinds.length) fail(400, "請至少勾一種學員可以交的形態");
  const name = "name" in b ? str(b.name, 60) : String(base?.name ?? "");
  if (!name) fail(400, "請填項目名稱");
  const r: Row = {
    name,
    note: "note" in b ? str(b.note, 500) : String(base?.note ?? ""),
    mode,
    per: pick("per", "per"),
    unit: "unit" in b ? str(b.unit, 6) || "件" : String(base?.unit ?? "件"),
    max_points: pick("maxPoints", "max_points"),
    min_count: pick("minCount", "min_count"),
    points: pick("points", "points"),
    full_score: pick("fullScore", "full_score"),
    in_total: "inTotal" in b ? (bool(b.inTotal) ? 1 : 0) : base ? Number(base.in_total) : mode === "onsite" ? 0 : 1,
    kinds: kinds.join(","),
    late_allowed: "lateAllowed" in b ? (b.lateAllowed === null ? null : bool(b.lateAllowed) ? 1 : 0) : (base?.late_allowed ?? null),
  };
  if (mode === "count" && (r.per == null || Number(r.per) <= 0)) r.per = 1;
  if (mode === "stars" && (r.per == null || Number(r.per) <= 0)) r.per = 1;
  if ((mode === "fixed" || mode === "pass") && r.points == null) r.points = 5;
  if ((mode === "score" || mode === "onsite") && (r.full_score == null || Number(r.full_score) <= 0)) r.full_score = 100;
  return r;
}
on("POST", "/lessons/:id/items", async (c, [id], req) => {
  const l = await c.env.DB.prepare("SELECT * FROM lessons WHERE id = ?").bind(id).first<Row>();
  if (!l) fail(404, "找不到這一堂");
  needManager(await access(c, String(l!.activity_id)));
  const f = itemFields(await body(req));
  const max = Number((await c.env.DB.prepare("SELECT COALESCE(MAX(position), 0) AS p FROM items WHERE lesson_id = ?").bind(id).first<Row>())?.p ?? 0);
  const iid = rid();
  await c.env.DB.prepare(
    "INSERT INTO items (id, activity_id, lesson_id, position, name, note, mode, per, unit, max_points, min_count, points, full_score, in_total, kinds, late_allowed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(iid, l!.activity_id, id, max + 1, f.name, f.note, f.mode, f.per, f.unit, f.max_points, f.min_count, f.points, f.full_score, f.in_total, f.kinds, f.late_allowed)
    .run();
  return { id: iid };
});
on("PATCH", "/items/:id", async (c, [id], req) => {
  const it = await c.env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(id).first<Row>();
  if (!it) fail(404, "找不到這個項目");
  needManager(await access(c, String(it!.activity_id)));
  const f = itemFields(await body(req), it!);
  const graded = await c.env.DB.prepare("SELECT 1 FROM submissions WHERE item_id = ? AND status = 'graded' LIMIT 1").bind(id).first();
  if (graded && f.mode !== it!.mode) fail(400, "已經有人被評分，不能再換計分方式");
  await c.env.DB.prepare("UPDATE items SET name = ?, note = ?, mode = ?, per = ?, unit = ?, max_points = ?, min_count = ?, points = ?, full_score = ?, in_total = ?, kinds = ?, late_allowed = ? WHERE id = ?")
    .bind(f.name, f.note, f.mode, f.per, f.unit, f.max_points, f.min_count, f.points, f.full_score, f.in_total, f.kinds, f.late_allowed, id)
    .run();
  // 規則改了，已評分的照新規則重算（核定件數、分數、星數不變）
  if (graded) {
    const card = itemCard({ ...it!, ...f, id, lesson_id: it!.lesson_id });
    const rows = (await c.env.DB.prepare("SELECT id, approved, score, stars FROM submissions WHERE item_id = ? AND status = 'graded'").bind(id).all<Row>()).results;
    for (const r of rows) await c.env.DB.prepare("UPDATE submissions SET points = ? WHERE id = ?").bind(pointsFor(card, { approved: num(r.approved), score: num(r.score), stars: num(r.stars) }), r.id).run();
  }
  return { ok: true };
});
on("DELETE", "/items/:id", async (c, [id]) => {
  const it = await c.env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(id).first<Row>();
  if (!it) fail(404, "找不到這個項目");
  needManager(await access(c, String(it!.activity_id)));
  if (await c.env.DB.prepare("SELECT 1 FROM submissions WHERE item_id = ? AND status != 'draft' LIMIT 1").bind(id).first()) fail(400, "已經有人交了，不能刪除");
  const keys = (await c.env.DB.prepare("SELECT f.r2_key FROM files f JOIN submissions s ON s.id = f.submission_id WHERE s.item_id = ? AND f.r2_key IS NOT NULL").bind(id).all<Row>()).results.map((r) => String(r.r2_key));
  await deleteR2(c.env, keys);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM files WHERE submission_id IN (SELECT id FROM submissions WHERE item_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM submissions WHERE item_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id),
  ]);
  return { ok: true };
});
on("POST", "/items/:id/move", async (c, [id], req) => {
  const it = await c.env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(id).first<Row>();
  if (!it) fail(404, "找不到這個項目");
  needManager(await access(c, String(it!.activity_id)));
  const dir = Number((await body(req)).dir) < 0 ? -1 : 1;
  const list = (await c.env.DB.prepare("SELECT id FROM items WHERE lesson_id = ? ORDER BY position, created_at").bind(it!.lesson_id).all<Row>()).results.map((r) => String(r.id));
  const i = list.indexOf(id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return { ok: true };
  [list[i], list[j]] = [list[j], list[i]];
  await c.env.DB.batch(list.map((x, k) => c.env.DB.prepare("UPDATE items SET position = ? WHERE id = ?").bind(k + 1, x)));
  return { ok: true };
});

// 加入
on("GET", "/join/:code", async (c, [code]) => {
  const a = await c.env.DB.prepare("SELECT id, title, join_approval, status FROM activities WHERE join_code = ?").bind(code).first<Row>();
  const g = a ? null : await c.env.DB.prepare("SELECT g.id AS gid, g.name, a.id, a.title, a.join_approval, a.status FROM groups g JOIN activities a ON a.id = g.activity_id WHERE g.join_code = ?").bind(code).first<Row>();
  const r = a ?? g;
  if (!r) fail(404, "這個連結已失效，請向管理員索取新連結");
  const m = await membership(c.env.DB, String(r!.id), c.sub);
  return { activityId: r!.id, title: r!.title, groupName: g ? g.name : null, approval: !!r!.join_approval, joined: m ? m.status : null };
});
on("POST", "/join/:code", async (c, [code]) => {
  const db = c.env.DB;
  const a = await db.prepare("SELECT * FROM activities WHERE join_code = ?").bind(code).first<Row>();
  const g = a ? null : await db.prepare("SELECT * FROM groups WHERE join_code = ?").bind(code).first<Row>();
  const act = a ?? (g ? await db.prepare("SELECT * FROM activities WHERE id = ?").bind(g.activity_id).first<Row>() : null);
  if (!act) fail(404, "這個連結已失效，請向管理員索取新連結");
  if (act!.status === "closed") fail(400, "這份作業已結束");
  const existing = await db.prepare("SELECT * FROM members WHERE activity_id = ? AND member_id = ?").bind(act!.id, c.sub).first<Row>();
  const status = act!.join_approval && !(await superAdmin(c)) ? "pending" : "active";
  if (!existing || existing.status === "removed") {
    await db
      .prepare("INSERT INTO members (activity_id, member_id, role, status, group_id) VALUES (?, ?, 'student', ?, ?) ON CONFLICT(activity_id, member_id) DO UPDATE SET status = excluded.status, role = 'student', group_id = excluded.group_id, is_leader = 0")
      .bind(act!.id, c.sub, status, g ? g.id : null)
      .run();
    if (status === "pending") {
      const managers = (await db.prepare("SELECT member_id FROM members WHERE activity_id = ? AND role = 'manager' AND status = 'active'").bind(act!.id).all<Row>()).results.map((r) => String(r.member_id));
      await notify(db, managers, "有人申請加入", `「${act!.title}」有新的加入申請，請到分組頁核准。`, `/groups/${act!.id}`);
    }
  } else if (g && existing.role === "student" && !existing.group_id) {
    await db.prepare("UPDATE members SET group_id = ? WHERE activity_id = ? AND member_id = ?").bind(g.id, act!.id, c.sub).run();
  }
  const m = await membership(db, String(act!.id), c.sub);
  return { activityId: act!.id, status: m?.status ?? status };
});
on("POST", "/activities/:id/invites", async (c, [id], req) => {
  needManager(await access(c, id));
  const role = str((await body(req)).role, 10) === "manager" ? "manager" : "teacher";
  const code = rid(16);
  await c.env.DB.prepare("INSERT INTO invites (code, activity_id, role, expires_at, created_by) VALUES (?, ?, ?, ?, ?)").bind(code, id, role, new Date(Date.now() + 86400_000).toISOString(), c.sub).run();
  return { code, role };
});
on("POST", "/invite/:code", async (c, [code]) => {
  const db = c.env.DB;
  const inv = await db.prepare("SELECT * FROM invites WHERE code = ?").bind(code).first<Row>();
  if (!inv || inv.used_by || Date.parse(String(inv.expires_at)) < Date.now()) fail(410, "這個邀請已失效（24 小時內、只能一人使用）");
  const ok = await db.prepare("UPDATE invites SET used_by = ? WHERE code = ? AND used_by IS NULL").bind(c.sub, code).run();
  if (!ok.meta?.changes) fail(410, "這個邀請已被使用");
  await db
    .prepare("INSERT INTO members (activity_id, member_id, role, status) VALUES (?, ?, ?, 'active') ON CONFLICT(activity_id, member_id) DO UPDATE SET role = excluded.role, status = 'active', group_id = NULL, is_leader = 0")
    .bind(inv!.activity_id, c.sub, inv!.role)
    .run();
  return { activityId: inv!.activity_id, role: inv!.role };
});

// 人員與分組
on("GET", "/activities/:id/people", async (c, [id]) => people(c, id));
on("POST", "/activities/:id/people/:member", async (c, [id, member], req) => {
  await personAction(c, id, decodeURIComponent(member), await body(req));
  return { ok: true };
});
on("POST", "/activities/:id/groups", async (c, [id], req) => {
  needTeacher(await access(c, id));
  const n = Number((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM groups WHERE activity_id = ?").bind(id).first<Row>())?.n ?? 0);
  const gid = rid();
  await c.env.DB.prepare("INSERT INTO groups (id, activity_id, name, position, join_code) VALUES (?, ?, ?, ?, ?)").bind(gid, id, str((await body(req)).name, 30) || `第 ${n + 1} 組`, n + 1, rid(8)).run();
  return { id: gid };
});
on("PATCH", "/groups/:id", async (c, [id], req) => {
  const g = await c.env.DB.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first<Row>();
  if (!g) fail(404, "找不到這一組");
  const a = await access(c, String(g!.activity_id));
  if (!a.teacher && !(a.m?.isLeader && a.m.groupId === id)) fail(403, "只有老師或本組組長可以改組名");
  const name = str((await body(req)).name, 30);
  if (!name) fail(400, "請填組名");
  await c.env.DB.prepare("UPDATE groups SET name = ? WHERE id = ?").bind(name, id).run();
  return { ok: true };
});
on("DELETE", "/groups/:id", async (c, [id]) => {
  const g = await c.env.DB.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first<Row>();
  if (!g) fail(404, "找不到這一組");
  needTeacher(await access(c, String(g!.activity_id)));
  await c.env.DB.batch([c.env.DB.prepare("UPDATE members SET group_id = NULL, is_leader = 0 WHERE group_id = ?").bind(id), c.env.DB.prepare("DELETE FROM groups WHERE id = ?").bind(id)]);
  return { ok: true };
});
on("POST", "/groups/:id/join-code", async (c, [id]) => {
  const g = await c.env.DB.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first<Row>();
  if (!g) fail(404, "找不到這一組");
  needTeacher(await access(c, String(g!.activity_id)));
  const code = rid(8);
  await c.env.DB.prepare("UPDATE groups SET join_code = ? WHERE id = ?").bind(code, id).run();
  return { joinCode: code };
});

// 學員繳交
on("GET", "/items/:id", async (c, [id]) => itemView(c, id));
on("POST", "/items/:id/files", async (c, [id], req) => {
  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") ?? "") as Kind;
  if (!["photo", "video", "file"].includes(kind)) fail(400, "檔案種類不正確");
  const { item, s } = await editableSubmission(c, id);
  if (!itemCard(item).kinds.includes(kind)) fail(400, `這一項不收${KINDS[kind]}`);
  if ((await countEntries(c.env.DB, s.id)) >= LIMITS.entries) fail(400, `每份最多 ${LIMITS.entries} 個檔案或連結`);
  const limitMB = kind === "photo" ? LIMITS.photoMB : kind === "video" ? LIMITS.videoMB : LIMITS.fileMB;
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > limitMB * 1048576) fail(413, `${KINDS[kind]}最大 ${limitMB}MB`);
  if (kind === "video" && Number(url.searchParams.get("dur") ?? 0) > LIMITS.videoSeconds + 1) fail(413, "短影片要在 3 分鐘內");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.byteLength) fail(400, "檔案是空的");
  if (bytes.byteLength > limitMB * 1048576) fail(413, `${KINDS[kind]}最大 ${limitMB}MB`);
  const name = (url.searchParams.get("name") ?? "").replace(/[\\/\0]/g, "").slice(0, 120) || KINDS[kind];
  const t = sniff(kind, bytes, name, req.headers.get("content-type") ?? "");
  if (!t.ok) fail(400, kind === "photo" ? "這不是照片檔（請選 JPG、PNG、HEIC）" : kind === "video" ? "這不是影片檔（請選 MP4、MOV）" : "不支援這種檔案；影片請用「短影片」上傳");
  const key = `sub/${item.activity_id}/${s.id}/${rid(16)}`;
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: t.contentType } });
  const pos = (await countEntries(c.env.DB, s.id)) + 1;
  await c.env.DB.prepare("INSERT INTO files (id, submission_id, kind, name, r2_key, content_type, size, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(rid(), s.id, kind, name, key, t.contentType, bytes.byteLength, pos).run();
  await c.env.DB.prepare("UPDATE submissions SET updated_at = ? WHERE id = ?").bind(now(), s.id).run();
  return itemView(c, id);
});
on("POST", "/items/:id/entries", async (c, [id], req) => {
  const b = await body(req);
  const kind = str(b.kind, 10) as Kind;
  if (kind !== "link" && kind !== "text") fail(400, "種類不正確");
  const { item, s } = await editableSubmission(c, id);
  if (!itemCard(item).kinds.includes(kind)) fail(400, `這一項不收${KINDS[kind]}`);
  if ((await countEntries(c.env.DB, s.id)) >= LIMITS.entries) fail(400, `每份最多 ${LIMITS.entries} 個檔案或連結`);
  const pos = (await countEntries(c.env.DB, s.id)) + 1;
  if (kind === "link") {
    let u = str(b.url, 1000);
    if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
    try {
      const p = new URL(u);
      if (!/^https?:$/.test(p.protocol)) throw 0;
    } catch {
      fail(400, "連結格式不正確");
    }
    await c.env.DB.prepare("INSERT INTO files (id, submission_id, kind, name, url, position) VALUES (?, ?, 'link', ?, ?, ?)").bind(rid(), s.id, str(b.name, 120) || new URL(u).hostname, u, pos).run();
  } else {
    const text = str(b.body, LIMITS.textChars);
    if (!text) fail(400, "請寫一點內容");
    await c.env.DB.prepare("INSERT INTO files (id, submission_id, kind, name, body, size, position) VALUES (?, ?, 'text', ?, ?, ?, ?)").bind(rid(), s.id, str(b.name, 60) || "文字心得", text, text.length, pos).run();
  }
  return itemView(c, id);
});
on("DELETE", "/files/:id", async (c, [id]) => {
  const f = await c.env.DB.prepare("SELECT f.*, s.item_id, s.member_id FROM files f JOIN submissions s ON s.id = f.submission_id WHERE f.id = ?").bind(id).first<Row>();
  if (!f || f.member_id !== c.sub) fail(404, "找不到這個檔案");
  await editableSubmission(c, String(f!.item_id));
  if (f!.r2_key) await deleteR2(c.env, [String(f!.r2_key)]);
  await c.env.DB.prepare("DELETE FROM files WHERE id = ?").bind(id).run();
  return itemView(c, String(f!.item_id));
});
on("POST", "/items/:id/submit", async (c, [id], req) => {
  const b = await body(req);
  const { item, lesson, a, s } = await editableSubmission(c, id);
  const card = itemCard(item);
  if (!(await countEntries(c.env.DB, s.id))) fail(400, "請先放檔案、連結或文字再送出");
  const declared = card.mode === "count" ? num(b.declared) : null;
  if (card.mode === "count" && (declared == null || declared < 1 || declared > 1000)) fail(400, `請填你完成的${card.unit}數`);
  const late = deadlinePassed(lesson.due_at) ? 1 : 0;
  const leaderReview = !!a.m?.groupId && !a.m.isLeader && !!(await c.env.DB.prepare("SELECT 1 FROM members WHERE activity_id = ? AND group_id = ? AND is_leader = 1").bind(item.activity_id, a.m.groupId).first());
  await c.env.DB.prepare("UPDATE submissions SET status = 'submitted', declared = ?, note = ?, submitted_at = ?, late = ?, leader_note = '', updated_at = ? WHERE id = ?")
    .bind(declared == null ? null : Math.round(declared), str(b.note, 1000), now(), late, now(), s.id)
    .run();
  if (leaderReview) {
    const leader = await c.env.DB.prepare("SELECT member_id FROM members WHERE activity_id = ? AND group_id = ? AND is_leader = 1").bind(item.activity_id, a.m!.groupId).first<Row>();
    if (leader) await notify(c.env.DB, [String(leader.member_id)], "組員送出作業", `「${card.name}」有組員送出，請確認。`, `/review/${item.activity_id}`);
  }
  return itemView(c, id);
});
on("POST", "/items/:id/unsubmit", async (c, [id]) => {
  const { item, lesson, a } = await loadItem(c, id);
  needActive(a);
  const s = await c.env.DB.prepare("SELECT * FROM submissions WHERE item_id = ? AND member_id = ?").bind(id, c.sub).first<Row>();
  if (!s || !["submitted", "leader_ok"].includes(String(s.status))) fail(400, "這份作業不能收回");
  if (deadlinePassed(lesson.due_at) && !lateOk(item, a.activity)) fail(400, "已經截止，不能收回修改");
  await c.env.DB.prepare("UPDATE submissions SET status = 'draft', updated_at = ? WHERE id = ?").bind(now(), s!.id).run();
  return itemView(c, id);
});

// 下載憑證（作業檔案沒有公開網址）
on("POST", "/files/:id/ticket", async (c, [id]) => {
  const f = await c.env.DB.prepare("SELECT f.*, s.activity_id, s.member_id, s.status FROM files f JOIN submissions s ON s.id = f.submission_id WHERE f.id = ?").bind(id).first<Row>();
  if (!f || !f.r2_key) fail(404, "找不到這個檔案");
  await canSeeSubmission(c, { id: f!.submission_id, activity_id: f!.activity_id, member_id: f!.member_id, status: f!.status });
  const t = rid(24);
  await c.env.DB.prepare("INSERT INTO tickets (id, file_id, member_id, expires_at) VALUES (?, ?, ?, ?)").bind(t, id, c.sub, Date.now() + 600_000).run();
  return { url: `/f/${t}` };
});

// 繳交（老師、組長、同組）
on("GET", "/submissions/:id", async (c, [id]) => {
  const s = await c.env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first<Row>();
  if (!s) fail(404, "找不到這份作業");
  const see = await canSeeSubmission(c, s!);
  const item = (await c.env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(s!.item_id).first<Row>())!;
  return { submission: await submissionView(c, s!, { hideScores: see.hideScores, withComments: true }), item: itemCard(item), canGrade: see.a.teacher, canLeaderReview: see.leaderOfIt };
});
on("POST", "/submissions/:id/grade", async (c, [id], req) => {
  await grade(c, id, await body(req));
  return { ok: true };
});
on("POST", "/submissions/:id/return", async (c, [id], req) => {
  await returnSubmission(c, id, await body(req));
  return { ok: true };
});
on("POST", "/submissions/:id/leader-ok", async (c, [id], req) => {
  const s = await c.env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first<Row>();
  if (!s) fail(404, "找不到這份作業");
  const see = await canSeeSubmission(c, s!);
  if (!see.leaderOfIt) fail(403, "只有本組組長可以確認");
  if (s!.status !== "submitted") fail(400, "這份作業已不在等你確認");
  await c.env.DB.prepare("UPDATE submissions SET status = 'leader_ok', leader_note = ?, updated_at = ? WHERE id = ?").bind(str((await body(req)).note, 500), now(), id).run();
  return { ok: true };
});
on("POST", "/items/:id/onsite", async (c, [id], req) => {
  const { item, a } = await loadItem(c, id);
  needTeacher(a);
  const b = await body(req);
  const memberId = str(b.memberId, 128);
  const m = await membership(c.env.DB, String(item.activity_id), memberId);
  if (!m || m.role !== "student") fail(404, "找不到這位學員");
  const s = await mySubmissionFor(c.env.DB, item, memberId);
  await c.env.DB.prepare("UPDATE submissions SET status = 'submitted', submitted_at = COALESCE(submitted_at, ?) WHERE id = ?").bind(now(), s.id).run();
  await grade(c, String(s.id), b);
  return { ok: true };
});
async function mySubmissionFor(db: D1Database, item: Row, memberId: string): Promise<Row> {
  await db.prepare("INSERT INTO submissions (id, item_id, activity_id, member_id) VALUES (?, ?, ?, ?) ON CONFLICT(item_id, member_id) DO NOTHING").bind(rid(), item.id, item.activity_id, memberId).run();
  return (await db.prepare("SELECT * FROM submissions WHERE item_id = ? AND member_id = ?").bind(item.id, memberId).first<Row>())!;
}
on("GET", "/activities/:id/queue", async (c, [id]) => queue(c, id));

// 留言與檢舉
on("POST", "/submissions/:id/comments", async (c, [id], req) => {
  const s = await c.env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first<Row>();
  if (!s) fail(404, "找不到這份作業");
  const see = await canSeeSubmission(c, s!);
  const text = str((await body(req)).body, LIMITS.commentChars);
  if (!text) fail(400, "請寫留言內容");
  await c.env.DB.prepare("INSERT INTO comments (id, submission_id, member_id, body) VALUES (?, ?, ?, ?)").bind(rid(), id, c.sub, text).run();
  const item = (await c.env.DB.prepare("SELECT id, name FROM items WHERE id = ?").bind(s!.item_id).first<Row>())!;
  // 別人留言通知作業本人；本人留言通知他的組長（如果有）
  let to: string[] = [String(s!.member_id)];
  if (s!.member_id === c.sub) {
    const g = see.a.m?.groupId;
    const leader = g ? await c.env.DB.prepare("SELECT member_id FROM members WHERE activity_id = ? AND group_id = ? AND is_leader = 1").bind(s!.activity_id, g).first<Row>() : null;
    to = leader && leader.member_id !== c.sub ? [String(leader.member_id)] : [];
  }
  await notify(c.env.DB, to, "有人留言", `「${item.name}」：${text.slice(0, 60)}`, `/item/${item.id}`);
  return { ok: true };
});
on("POST", "/comments/:id/hide", async (c, [id]) => {
  const cm = await c.env.DB.prepare("SELECT c.*, s.activity_id FROM comments c JOIN submissions s ON s.id = c.submission_id WHERE c.id = ?").bind(id).first<Row>();
  if (!cm) fail(404, "找不到這則留言");
  if (cm!.member_id !== c.sub) needManager(await access(c, String(cm!.activity_id)));
  await c.env.DB.prepare("UPDATE comments SET hidden = 1 WHERE id = ?").bind(id).run();
  return { ok: true };
});
on("POST", "/reports", async (c, _p, req) => {
  const b = await body(req);
  const target = str(b.target, 80);
  const m = /^(comment|file):(.+)$/.exec(target);
  if (!m) fail(400, "檢舉對象不正確");
  const row =
    m![1] === "comment"
      ? await c.env.DB.prepare("SELECT s.* FROM comments c JOIN submissions s ON s.id = c.submission_id WHERE c.id = ?").bind(m![2]).first<Row>()
      : await c.env.DB.prepare("SELECT s.* FROM files f JOIN submissions s ON s.id = f.submission_id WHERE f.id = ?").bind(m![2]).first<Row>();
  if (!row) fail(404, "找不到檢舉的內容");
  await canSeeSubmission(c, row!);
  await c.env.DB.prepare("INSERT INTO reports (id, activity_id, target, member_id, reason) VALUES (?, ?, ?, ?, ?)").bind(rid(), row!.activity_id, target, c.sub, str(b.reason, 300)).run();
  const managers = (await c.env.DB.prepare("SELECT member_id FROM members WHERE activity_id = ? AND role = 'manager' AND status = 'active'").bind(row!.activity_id).all<Row>()).results.map((r) => String(r.member_id));
  await notify(c.env.DB, managers, "有人檢舉內容", "請到作業裡查看並處理。", `/item/${row!.item_id}`);
  return { ok: true };
});

// 提醒、通知
on("POST", "/lessons/:id/remind", async (c, [id]) => {
  const l = await c.env.DB.prepare("SELECT * FROM lessons WHERE id = ?").bind(id).first<Row>();
  if (!l) fail(404, "找不到這一堂");
  needTeacher(await access(c, String(l!.activity_id)));
  const ids = await notSubmitted(c.env.DB, l!);
  await notify(c.env.DB, ids, "作業提醒", `「${l!.title}」還有作業沒交${l!.due_at ? `，截止時間 ${twTime(String(l!.due_at))}` : ""}。`, `/activity/${l!.activity_id}`);
  return { reminded: ids.length };
});
async function notSubmitted(db: D1Database, lesson: Row): Promise<string[]> {
  return (
    await db
      .prepare(
        "SELECT m.member_id FROM members m WHERE m.activity_id = ? AND m.role = 'student' AND m.status = 'active' AND EXISTS (SELECT 1 FROM items i WHERE i.lesson_id = ? AND i.mode != 'onsite' AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.item_id = i.id AND s.member_id = m.member_id AND s.status IN ('submitted','leader_ok','graded')))",
      )
      .bind(lesson.activity_id, lesson.id)
      .all<Row>()
  ).results.map((r) => String(r.member_id));
}
export const twTime = (iso: string) => {
  const d = new Date(Date.parse(iso) + 8 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
on("GET", "/notices", async (c) => {
  const rows = (await c.env.DB.prepare("SELECT * FROM notices WHERE member_id = ? ORDER BY created_at DESC LIMIT 100").bind(c.sub).all<Row>()).results;
  return rows.map((r): Notice => ({ id: String(r.id), title: String(r.title), body: String(r.body), link: String(r.link), read: !!r.read_at, createdAt: String(r.created_at) }));
});
on("POST", "/notices/read", async (c, _p, req) => {
  const b = await body(req);
  if (typeof b.id === "string") await c.env.DB.prepare("UPDATE notices SET read_at = ? WHERE id = ? AND member_id = ?").bind(now(), b.id, c.sub).run();
  else await c.env.DB.prepare("UPDATE notices SET read_at = ? WHERE member_id = ? AND read_at IS NULL").bind(now(), c.sub).run();
  return { ok: true };
});

// 檔案保存：備份清單、成績表、刪除全部檔案
on("GET", "/activities/:id/files", async (c, [id], req) => {
  const a = await access(c, id);
  needActive(a);
  const mine = new URL(req.url).searchParams.get("mine") === "1" || !a.teacher;
  const rows = (
    await c.env.DB.prepare(
      `SELECT f.id, f.kind, f.name, f.size, f.url, f.body, f.r2_key, s.member_id, i.name AS item_name, l.title AS lesson_title FROM files f JOIN submissions s ON s.id = f.submission_id JOIN items i ON i.id = s.item_id JOIN lessons l ON l.id = i.lesson_id WHERE s.activity_id = ? ${mine ? "AND s.member_id = ?" : ""} ORDER BY l.position, i.position, s.member_id, f.position`,
    )
      .bind(...(mine ? [id, c.sub] : [id]))
      .all<Row>()
  ).results;
  const nm = await names(c.env.DB, rows.map((r) => String(r.member_id)));
  const out = [];
  for (const r of rows) {
    let url = r.kind === "link" ? String(r.url) : "";
    if (r.r2_key) {
      const t = rid(24);
      await c.env.DB.prepare("INSERT INTO tickets (id, file_id, member_id, expires_at) VALUES (?, ?, ?, ?)").bind(t, r.id, c.sub, Date.now() + 3600_000).run();
      url = `/f/${t}?download=1`;
    }
    out.push({ id: r.id, kind: r.kind, name: r.name, size: r.size, url, body: r.kind === "text" ? r.body : undefined, member: nameOr(nm, String(r.member_id)), item: r.item_name, lesson: r.lesson_title });
  }
  return { retentionUntil: a.activity.retention_until ?? null, purged: !!a.activity.files_purged_at, files: out };
});
on("GET", "/activities/:id/storage", async (c, [id]) => {
  needTeacher(await access(c, id));
  const r = await c.env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(f.size), 0) AS bytes FROM files f JOIN submissions s ON s.id = f.submission_id WHERE s.activity_id = ? AND f.r2_key IS NOT NULL").bind(id).first<Row>();
  return { files: Number(r?.n ?? 0), bytes: Number(r?.bytes ?? 0) };
});
on("POST", "/activities/:id/purge", async (c, [id]) => {
  needManager(await access(c, id));
  return { deleted: await purgeFiles(c.env, id) };
});
export async function purgeFiles(env: Env, activityId: string): Promise<number> {
  const rows = (await env.DB.prepare("SELECT f.id, f.r2_key FROM files f JOIN submissions s ON s.id = f.submission_id WHERE s.activity_id = ? AND f.r2_key IS NOT NULL").bind(activityId).all<Row>()).results;
  await deleteR2(env, rows.map((r) => String(r.r2_key)));
  await env.DB.batch([
    env.DB.prepare("UPDATE files SET r2_key = NULL, size = 0 WHERE submission_id IN (SELECT id FROM submissions WHERE activity_id = ?) AND r2_key IS NOT NULL").bind(activityId),
    env.DB.prepare("UPDATE activities SET files_purged_at = ? WHERE id = ?").bind(now(), activityId),
  ]);
  return rows.length;
}
on("GET", "/activities/:id/scores", async (c, [id]) => {
  needTeacher(await access(c, id));
  const db = c.env.DB;
  const items = (await db.prepare("SELECT i.*, l.title AS lesson_title FROM items i JOIN lessons l ON l.id = i.lesson_id WHERE i.activity_id = ? ORDER BY l.position, i.position").bind(id).all<Row>()).results;
  const ms = (await db.prepare("SELECT m.member_id, g.name AS gname FROM members m LEFT JOIN groups g ON g.id = m.group_id WHERE m.activity_id = ? AND m.role = 'student' AND m.status = 'active' ORDER BY g.position, m.joined_at").bind(id).all<Row>()).results;
  const subs = (await db.prepare("SELECT member_id, item_id, points, status FROM submissions WHERE activity_id = ?").bind(id).all<Row>()).results;
  const nm = await names(db, ms.map((m) => String(m.member_id)));
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["姓名", "組別", ...items.map((i) => `${i.lesson_title} ${i.name}`), "總分"];
  const lines = [head.map(esc).join(",")];
  for (const m of ms) {
    let total = 0;
    const cells = items.map((i) => {
      const s = subs.find((x) => x.member_id === m.member_id && x.item_id === i.id);
      if (s?.status === "graded") {
        if (i.in_total) total += Number(s.points ?? 0);
        return s.points;
      }
      return "";
    });
    lines.push([nameOr(nm, String(m.member_id)), m.gname ?? "", ...cells, Math.round(total * 10) / 10].map(esc).join(","));
  }
  return new Response("﻿" + lines.join("\r\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="scores.csv"`, "cache-control": "no-store" } });
});

// ───────────── 進入點 ─────────────
export async function handleApi(req: Request, env: Env, bg: (p: Promise<unknown>) => void = () => {}): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  try {
    if (path === "/version") return json({ version: API_VERSION, integrated: INTEGRATED_VERSION });
    if (path === "/central/webhook" && req.method === "POST") return await webhook(req, env);
    const auth = await authenticate(req, env);
    if (!auth) return json({ error: { code: "unauthenticated", message: "請先登入" } }, 401);
    const c: Ctx = { env, sub: auth.sub, token: auth.token, bg };
    let queued = false;
    pushSoon = () => {
      if (queued) return;
      queued = true;
      bg(flushPushes(env));
    };
    for (const [method, re, h] of routes) {
      if (method !== req.method) continue;
      const m = re.exec(path);
      if (!m) continue;
      bg(refreshPersonThrottled(c));
      const out = await h(c, m.slice(1).map(decodeURIComponent), req);
      return out instanceof Response ? out : json(out);
    }
    return json({ error: { code: "not_found", message: "找不到這個功能" } }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: { code: "error", message: e.message } }, e.status);
    console.error("api_error", req.method, path, String((e as Error)?.message ?? e).slice(0, 200));
    return json({ error: { code: "server_error", message: "系統忙碌，請稍後再試" } }, 500);
  }
}
const lastRefresh = new Map<string, number>();
async function refreshPersonThrottled(c: Ctx): Promise<void> {
  const t = lastRefresh.get(c.sub) ?? 0;
  if (Date.now() - t < 600_000) {
    const stale = await c.env.DB.prepare("SELECT stale FROM people WHERE member_id = ?").bind(c.sub).first<Row>();
    if (stale && !stale.stale) return;
  }
  lastRefresh.set(c.sub, Date.now());
  try {
    await refreshPerson(c);
  } catch {
    /* 讀不到名字不影響功能 */
  }
}

/** 下載：GET /f/<憑證>（10 分鐘內有效，支援影片分段讀取）。 */
export async function handleFile(req: Request, env: Env): Promise<Response> {
  const id = new URL(req.url).pathname.split("/")[2] ?? "";
  const t = await env.DB.prepare("SELECT t.*, f.r2_key, f.name, f.content_type FROM tickets t JOIN files f ON f.id = t.file_id WHERE t.id = ?").bind(id).first<Row>();
  if (!t || Number(t.expires_at) < Date.now() || !t.r2_key) return new Response("連結已失效，請回到 App 重新開啟", { status: 410, headers: { "content-type": "text/plain; charset=utf-8" } });
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") ?? "");
  const head = await env.FILES.head(String(t.r2_key));
  if (!head) return new Response("檔案已刪除", { status: 410, headers: { "content-type": "text/plain; charset=utf-8" } });
  const size = head.size;
  const download = new URL(req.url).searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "content-type": String(t.content_type || "application/octet-stream"),
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(String(t.name || "file"))}`,
  };
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || end < start) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const obj = await env.FILES.get(String(t.r2_key), { range: { offset: start, length: end - start + 1 } });
    if (!obj) return new Response("檔案已刪除", { status: 410 });
    return new Response(obj.body, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  const obj = await env.FILES.get(String(t.r2_key));
  if (!obj) return new Response("檔案已刪除", { status: 410 });
  return new Response(obj.body, { headers: { ...headers, "content-length": String(size) } });
}

/** 中央 webhook：member.deleted 刪除這位會員在本 App 的所有資料（含作業檔案）；member.profile_changed 標記重讀名字。 */
async function webhook(req: Request, env: Env): Promise<Response> {
  const raw = await req.text();
  if (!env.CENTRAL_WEBHOOK_SECRET) return json({ error: { code: "not_configured", message: "webhook 尚未設定" } }, 503);
  const ok = await verifyWebhook(env.CENTRAL_WEBHOOK_SECRET, req.headers.get("x-hg-timestamp"), req.headers.get("x-hg-signature"), raw);
  if (!ok) return json({ error: { code: "bad_signature", message: "簽章不正確" } }, 401);
  let ev: { id?: string; type?: string; member_id?: string; fields?: string[] };
  try {
    ev = JSON.parse(raw);
  } catch {
    return json({ error: { code: "bad_request", message: "內容不正確" } }, 400);
  }
  const id = String(ev.id ?? req.headers.get("x-hg-event-id") ?? "");
  if (!id) return json({ error: { code: "bad_request", message: "缺少事件編號" } }, 400);
  const fresh = await env.DB.prepare("INSERT INTO webhook_events (id) VALUES (?) ON CONFLICT(id) DO NOTHING").bind(id).run();
  if (!fresh.meta?.changes) return json({ ok: true, duplicate: true });
  const member = typeof ev.member_id === "string" ? ev.member_id : "";
  if (ev.type === "member.deleted" && member) await deleteMemberData(env, member);
  if (ev.type === "member.profile_changed" && member) {
    await env.DB.prepare("UPDATE people SET stale = 1 WHERE member_id = ?").bind(member).run();
    forgetMember(member);
  }
  return json({ ok: true });
}

/** 刪除一位會員在本 App 的所有副本：作業檔案（R2）、繳交、留言、通知、成員資格、名字。 */
export async function deleteMemberData(env: Env, member: string): Promise<void> {
  const db = env.DB;
  const keys = (await db.prepare("SELECT f.r2_key FROM files f JOIN submissions s ON s.id = f.submission_id WHERE s.member_id = ? AND f.r2_key IS NOT NULL").bind(member).all<Row>()).results.map((r) => String(r.r2_key));
  await deleteR2(env, keys);
  await db.batch([
    db.prepare("DELETE FROM files WHERE submission_id IN (SELECT id FROM submissions WHERE member_id = ?)").bind(member),
    db.prepare("DELETE FROM comments WHERE submission_id IN (SELECT id FROM submissions WHERE member_id = ?)").bind(member),
    db.prepare("DELETE FROM submissions WHERE member_id = ?").bind(member),
    db.prepare("DELETE FROM comments WHERE member_id = ?").bind(member),
    db.prepare("DELETE FROM notices WHERE member_id = ?").bind(member),
    db.prepare("DELETE FROM tickets WHERE member_id = ?").bind(member),
    db.prepare("DELETE FROM reports WHERE member_id = ?").bind(member),
    db.prepare("DELETE FROM reminders_sent WHERE member_id = ?").bind(member),
    db.prepare("DELETE FROM members WHERE member_id = ?").bind(member),
    db.prepare("DELETE FROM people WHERE member_id = ?").bind(member),
    db.prepare("DELETE FROM push_subs WHERE member_id = ?").bind(member),
  ]);
  forgetMember(member);
}

/** 排程（每小時）：截止前 3 天、1 天自動提醒；到期自動刪除檔案（前 30／7／1 天預告）；清掉過期下載憑證。 */
export async function scheduled(env: Env): Promise<void> {
  const db = env.DB;
  pushSoon = null;
  await db.prepare("DELETE FROM tickets WHERE expires_at < ?").bind(Date.now()).run();
  const t = Date.now();
  const lessons = (
    await db
      .prepare("SELECT l.*, a.title AS atitle FROM lessons l JOIN activities a ON a.id = l.activity_id WHERE a.status = 'open' AND a.auto_remind = 1 AND l.due_at > ? AND l.due_at <= ?")
      .bind(new Date(t).toISOString(), new Date(t + 3 * 86400_000).toISOString())
      .all<Row>()
  ).results;
  for (const l of lessons) {
    const kind = Date.parse(String(l.due_at)) - t <= 86400_000 ? "d1" : "d3";
    const ids = await notSubmitted(db, l);
    const sent = new Set((await db.prepare("SELECT member_id FROM reminders_sent WHERE lesson_id = ? AND kind = ?").bind(l.id, kind).all<Row>()).results.map((r) => String(r.member_id)));
    const todo = ids.filter((x) => !sent.has(x));
    if (!todo.length) continue;
    await notify(db, todo, kind === "d1" ? "作業明天截止" : "作業 3 天後截止", `「${l.atitle}」${l.title}：截止時間 ${twTime(String(l.due_at))}，記得交作業。`, `/activity/${l.activity_id}`);
    await db.batch(todo.map((m) => db.prepare("INSERT INTO reminders_sent (lesson_id, member_id, kind) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(l.id, m, kind)));
  }
  // 檔案保存期限
  const today = new Date(t + 8 * 3600_000).toISOString().slice(0, 10);
  const acts = (await db.prepare("SELECT * FROM activities WHERE retention_until IS NOT NULL AND files_purged_at IS NULL").all<Row>()).results;
  for (const a of acts) {
    const until = String(a.retention_until);
    if (until <= today) {
      await purgeFiles(env, String(a.id));
      continue;
    }
    const days = Math.round((Date.parse(until) - Date.parse(today)) / 86400_000);
    if (![30, 7, 1].includes(days)) continue;
    const key = `purge-d${days}`;
    const ids = (await db.prepare("SELECT member_id FROM members WHERE activity_id = ? AND status = 'active'").bind(a.id).all<Row>()).results.map((r) => String(r.member_id));
    const sent = new Set((await db.prepare("SELECT member_id FROM reminders_sent WHERE lesson_id = ? AND kind = ?").bind(a.id, key).all<Row>()).results.map((r) => String(r.member_id)));
    const todo = ids.filter((x) => !sent.has(x));
    if (!todo.length) continue;
    await notify(db, todo, `作業檔案 ${days} 天後刪除`, `「${a.title}」的作業檔案將在 ${until} 刪除（成績保留），需要的話請先下載備份。`, `/me`);
    await db.batch(todo.map((m) => db.prepare("INSERT INTO reminders_sent (lesson_id, member_id, kind) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(a.id, m, key)));
  }
  await flushPushes(env).catch((e) => console.error("push flush", e instanceof Error ? e.message : "error"));
}
