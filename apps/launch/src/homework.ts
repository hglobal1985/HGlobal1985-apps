import type { HwAssignment, HwAssignmentView, HwComment, HwCourseView, HwFile, HwGrading, HwGroupMember, HwGroupsView, HwKind, HwResult, HwRole, HwRosterRow, HwStatus, HwSubmission, MyHomework, MyHomeworkItem } from "./contract.ts";
import { HW_GRADINGS, HW_KINDS, HW_LIMITS, HW_VIDEO } from "./contract.ts";
import type { D1Database, D1PreparedStatement, Env } from "./d1.ts";
import { classifyFile } from "./files.ts";
import { parseHttpsUrl } from "./links.ts";
import { sniffImage } from "./media.ts";

/**
 * 作業功能（業主 2026-11-25；第一個用在美力之星）。
 * - 作業屬於一門課；只有這門課已開通的學員（enrollments）能交。
 * - 老師（可以出作業、評分）＝超級管理員、有這門課修改權的人、這門課「費用與審核」的審核窗口（由 api.ts 的 isTeacher 判斷）。
 * - 組長、老師都可以編組（組長只能把還沒分組的學員拉進自己這組、或移出自己這組）；評分只有老師。
 * - 同組學員可以互看已送出的作業（看不到分數）；組長可以看同組作業並留言。
 * - 檔案存 R2 的 hw/…，一律用短效簽名網址讀取，網址不會永久有效。
 */
export type HwMe = { sub: string; name: string; admin: boolean };
export type HwDeps = {
  db: D1Database;
  env: Env;
  url: URL;
  req: Request;
  me: HwMe | null;
  fail: (status: number, code: string, message: string) => never;
  notify: (sub: string, title: string, body: string, link: string) => D1PreparedStatement;
  isTeacher: (courseId: string) => Promise<boolean>;
};
type Route = [string, RegExp, (h: HwDeps, p: string[]) => Promise<unknown>];

const MB = 1024 * 1024;
const now = () => new Date().toISOString();
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const need = (h: HwDeps): HwMe => h.me ?? h.fail(401, "unauthenticated", "請先登入");
async function body<T>(h: HwDeps): Promise<T> {
  try {
    return (await h.req.json()) as T;
  } catch {
    return h.fail(400, "bad_json", "請求格式錯誤");
  }
}
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ---------- 短效簽名網址（img、video 標籤無法帶登入資訊） ----------
const enc = new TextEncoder();
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
async function sign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
async function fileUrl(env: Env, key: string | null, name = "", hours = 6): Promise<string> {
  if (!key || !env.MEDIA_URL_SECRET) return "";
  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  return `/api/v2/homework/file?k=${encodeURIComponent(key)}&e=${exp}&n=${encodeURIComponent(name)}&s=${await sign(env.MEDIA_URL_SECRET, `${key}|${exp}|${name}`)}`;
}
async function verifyFileUrl(env: Env, url: URL): Promise<{ key: string; name: string } | null> {
  const key = url.searchParams.get("k") ?? "";
  const name = url.searchParams.get("n") ?? "";
  const exp = Number(url.searchParams.get("e"));
  const sig = url.searchParams.get("s") ?? "";
  if (!env.MEDIA_URL_SECRET || !key.startsWith("hw/") || !Number.isInteger(exp) || exp < Date.now() / 1000) return null;
  const want = await sign(env.MEDIA_URL_SECRET, `${key}|${exp}|${name}`);
  if (want.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? { key, name } : null;
}

// ---------- 身份 ----------
async function courseOf(h: HwDeps, courseId: string): Promise<{ id: string; title: string }> {
  const c = await h.db.prepare("SELECT id, title FROM courses WHERE id = ?").bind(courseId).first<{ id: string; title: string }>();
  return c ?? h.fail(404, "not_found", "找不到這門課程");
}
async function roleOf(h: HwDeps, courseId: string): Promise<HwRole> {
  const me = h.me;
  if (!me) return { teacher: false, enrolled: false, groupId: null, leaderOf: null };
  const [teacher, e, g] = await Promise.all([
    h.isTeacher(courseId),
    h.db.prepare("SELECT 1 AS ok FROM enrollments WHERE member_sub = ? AND course_id = ?").bind(me.sub, courseId).first(),
    h.db.prepare("SELECT group_id, is_leader FROM hw_group_members WHERE course_id = ? AND member_sub = ?").bind(courseId, me.sub).first<{ group_id: string; is_leader: number }>(),
  ]);
  return { teacher, enrolled: !!e, groupId: g?.group_id ?? null, leaderOf: g?.is_leader ? g.group_id : null };
}
function requireIn(h: HwDeps, r: HwRole): void {
  if (!h.me) h.fail(401, "unauthenticated", "請先登入");
  if (!r.teacher && !r.enrolled && !r.groupId) h.fail(403, "forbidden", "報名並開通這門課之後，才看得到作業");
}
const requireTeacher = (h: HwDeps, r: HwRole) => (r.teacher ? undefined : h.fail(403, "forbidden", "只有老師（課程管理者、批改人員）可以做這件事"));

type MemberRow = { sub: string; name: string; avatar: string | null; group_id: string | null; group_name: string | null; is_leader: number | null; position: number | null };
/** 這門課已開通的學員（名稱用會員最新暱稱，沒有就用報名時的名稱）＋分組。 */
async function members(db: D1Database, courseId: string): Promise<MemberRow[]> {
  const { results } = await db
    .prepare(
      `SELECT e.member_sub AS sub, COALESCE(NULLIF(p.name, ''), o.member_name_snapshot, '學員') AS name, NULLIF(p.avatar, '') AS avatar,
              gm.group_id, g.name AS group_name, gm.is_leader, g.position
       FROM enrollments e
       LEFT JOIN member_profiles p ON p.sub = e.member_sub
       LEFT JOIN orders o ON o.id = e.source_order_id
       LEFT JOIN hw_group_members gm ON gm.course_id = e.course_id AND gm.member_sub = e.member_sub
       LEFT JOIN hw_groups g ON g.id = gm.group_id
       WHERE e.course_id = ?
       ORDER BY COALESCE(g.position, 9999), gm.is_leader DESC, name`,
    )
    .bind(courseId)
    .all<MemberRow>();
  return results;
}

// ---------- 資料轉換 ----------
type ARow = { id: string; course_id: string; title: string; body: string; kinds: string; grading: string; max_score: number; opens_at: string | null; due_at: string | null; created_at: string };
type SRow = { id: string; assignment_id: string; course_id: string; member_sub: string; member_name: string; note: string; status: string; score: number | null; stars: number | null; passed: number | null; comment: string; graded_by_name: string; graded_at: string | null; submitted_at: string | null };
const kindsOf = (s: string): HwKind[] => s.split(",").filter((k): k is HwKind => HW_KINDS.some((x) => x.key === k));
const gradingOf = (s: string): HwGrading => (HW_GRADINGS.some((x) => x.key === s) ? (s as HwGrading) : "score");
const statusOf = (s: SRow | null | undefined): HwStatus => (!s ? "none" : (["draft", "submitted", "graded", "returned"] as const).find((x) => x === s.status) ?? "draft");
function resultOf(s: SRow | null | undefined): HwResult | null {
  if (!s || (s.status !== "graded" && s.status !== "returned")) return null;
  return { score: s.score, stars: s.stars, passed: s.passed == null ? null : s.passed === 1, comment: s.comment, gradedBy: s.graded_by_name, gradedAt: s.graded_at };
}
const isLate = (a: ARow, s: SRow | null | undefined) => !!(a.due_at && s?.submitted_at && s.submitted_at > a.due_at);
function toAssignment(a: ARow, mine: SRow | null, counts: HwAssignment["counts"]): HwAssignment {
  const t = now();
  return {
    id: a.id,
    courseId: a.course_id,
    title: a.title,
    body: a.body,
    kinds: kindsOf(a.kinds),
    grading: gradingOf(a.grading),
    maxScore: a.max_score,
    opensAt: a.opens_at,
    dueAt: a.due_at,
    createdAt: a.created_at,
    open: !a.opens_at || a.opens_at <= t,
    overdue: !!a.due_at && a.due_at < t,
    myStatus: statusOf(mine),
    myResult: resultOf(mine),
    counts,
  };
}
function countsOf(subs: SRow[], subsIn: Set<string>): NonNullable<HwAssignment["counts"]> {
  const mine = subs.filter((s) => subsIn.has(s.member_sub) && s.status !== "draft");
  return { members: subsIn.size, submitted: mine.length, toGrade: mine.filter((s) => s.status === "submitted").length, graded: mine.filter((s) => s.status === "graded").length, returned: mine.filter((s) => s.status === "returned").length };
}
async function assignmentRow(h: HwDeps, id: string): Promise<ARow> {
  const a = await h.db.prepare("SELECT * FROM hw_assignments WHERE id = ?").bind(id).first<ARow>();
  return a ?? h.fail(404, "not_found", "找不到這份作業");
}

async function filesOf(h: HwDeps, submissionId: string): Promise<HwFile[]> {
  const { results } = await h.db
    .prepare("SELECT id, kind, name, r2_key, poster_key, link_url, content_type, size, width, height, duration_sec FROM hw_files WHERE submission_id = ? ORDER BY position, created_at")
    .bind(submissionId)
    .all<{ id: string; kind: HwFile["kind"]; name: string; r2_key: string | null; poster_key: string | null; link_url: string | null; content_type: string; size: number; width: number; height: number; duration_sec: number }>();
  return Promise.all(
    results.map(async (f) => ({
      id: f.id,
      kind: f.kind,
      name: f.name,
      url: f.kind === "link" ? (f.link_url ?? "") : await fileUrl(h.env, f.r2_key, f.kind === "file" ? f.name : ""),
      posterUrl: f.poster_key ? await fileUrl(h.env, f.poster_key) : null,
      size: f.size,
      width: f.width,
      height: f.height,
      durationSec: f.duration_sec,
      contentType: f.content_type,
    })),
  );
}

/** 這位登入者能不能看這份繳交：本人、老師、同組（已送出的）。 */
function canView(me: HwMe, r: HwRole, s: SRow, ownerGroup: string | null): boolean {
  if (s.member_sub === me.sub || r.teacher) return true;
  return !!r.groupId && r.groupId === ownerGroup && s.status !== "draft";
}
async function ownerGroupOf(db: D1Database, courseId: string, sub: string): Promise<{ id: string; name: string } | null> {
  return db.prepare("SELECT g.id, g.name FROM hw_group_members gm JOIN hw_groups g ON g.id = gm.group_id WHERE gm.course_id = ? AND gm.member_sub = ?").bind(courseId, sub).first<{ id: string; name: string }>();
}

async function submissionView(h: HwDeps, s: SRow, a: ARow, r: HwRole): Promise<HwSubmission> {
  const me = need(h);
  const g = await ownerGroupOf(h.db, s.course_id, s.member_sub);
  if (!canView(me, r, s, g?.id ?? null)) h.fail(403, "forbidden", "這份作業不公開，只有本人、同組組員和老師看得到");
  const mine = s.member_sub === me.sub;
  const [files, cm, prof, next] = await Promise.all([
    filesOf(h, s.id),
    h.db.prepare("SELECT id, author_sub, author_name, role, body, created_at FROM hw_comments WHERE submission_id = ? ORDER BY created_at").bind(s.id).all<{ id: string; author_sub: string; author_name: string; role: string; body: string; created_at: string }>(),
    h.db.prepare("SELECT name, NULLIF(avatar, '') AS avatar FROM member_profiles WHERE sub = ?").bind(s.member_sub).first<{ name: string; avatar: string | null }>(),
    r.teacher ? h.db.prepare("SELECT id FROM hw_submissions WHERE assignment_id = ? AND status = 'submitted' AND id <> ? ORDER BY submitted_at LIMIT 1").bind(s.assignment_id, s.id).first<{ id: string }>() : null,
  ]);
  const leaderHere = !!r.leaderOf && r.leaderOf === g?.id;
  const showResult = mine || r.teacher || leaderHere; // 同組組員看不到別人的分數
  return {
    id: s.id,
    assignmentId: s.assignment_id,
    memberName: prof?.name || s.member_name || "學員",
    avatar: prof?.avatar ?? null,
    groupName: g?.name ?? null,
    status: statusOf(s),
    note: s.note,
    submittedAt: s.submitted_at,
    late: isLate(a, s),
    result: showResult ? resultOf(s) : null,
    files,
    comments: cm.results.map((c) => ({ id: c.id, authorName: c.author_name, role: c.role === "teacher" || c.role === "leader" ? c.role : "student", body: c.body, createdAt: c.created_at, mine: c.author_sub === me.sub })) satisfies HwComment[],
    mine,
    canEdit: mine && s.status !== "graded",
    canGrade: r.teacher && s.status !== "draft",
    canComment: s.status !== "draft" && (mine || r.teacher || leaderHere),
    nextToGrade: next?.id ?? null,
  };
}

// ---------- 作業內容檢查 ----------
function readAssignment(h: HwDeps, b: Record<string, unknown>, cur?: ARow): { title: string; body: string; kinds: string; grading: HwGrading; maxScore: number; opensAt: string | null; dueAt: string | null } {
  const title = b.title === undefined && cur ? cur.title : str(b.title, 80);
  if (!title) h.fail(400, "invalid_title", "請輸入作業名稱");
  const text = b.body === undefined && cur ? cur.body : str(b.body, 3000);
  const kinds = b.kinds === undefined && cur ? kindsOf(cur.kinds) : Array.isArray(b.kinds) ? HW_KINDS.map((k) => k.key).filter((k) => (b.kinds as unknown[]).includes(k)) : [];
  if (!kinds.length) h.fail(400, "invalid_kinds", "請至少勾選一種學員可以交的東西");
  const grading = b.grading === undefined && cur ? gradingOf(cur.grading) : HW_GRADINGS.find((g) => g.key === b.grading)?.key ?? h.fail(400, "invalid_grading", "請選擇評分方式");
  const maxScore = b.maxScore === undefined ? (cur?.max_score ?? 100) : Number(b.maxScore);
  if (!Number.isInteger(maxScore) || maxScore < 1 || maxScore > 1000) h.fail(400, "invalid_max", "滿分請填 1～1000 的整數");
  const date = (v: unknown, old: string | null | undefined): string | null => {
    if (v === undefined) return old ?? null;
    if (v === null || v === "") return null;
    const d = typeof v === "string" ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toISOString() : h.fail(400, "invalid_date", "日期格式不正確");
  };
  const opensAt = date(b.opensAt, cur?.opens_at);
  const dueAt = date(b.dueAt, cur?.due_at);
  if (opensAt && dueAt && dueAt <= opensAt) h.fail(400, "invalid_due", "截止時間要晚於開放時間");
  return { title, body: text, kinds: kinds.join(","), grading, maxScore, opensAt, dueAt };
}
const fmtDate = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000); // 台灣時間
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const resultText = (g: HwGrading, max: number, s: { score: number | null; stars: number | null; passed: number | null }) =>
  g === "score" ? `得到 ${s.score} 分（滿分 ${max}）` : g === "stars" ? `得到 ${"★".repeat(s.stars ?? 0)}${"☆".repeat(5 - (s.stars ?? 0))}` : "通過";

// ---------- 學員的繳交 ----------
/** 學員要改自己的繳交：取得（沒有就建一筆草稿）；已評分的不能再改。 */
async function editableSubmission(h: HwDeps, a: ARow): Promise<SRow> {
  const me = need(h);
  const ok = await h.db.prepare("SELECT 1 AS ok FROM enrollments WHERE member_sub = ? AND course_id = ?").bind(me.sub, a.course_id).first();
  if (!ok) h.fail(403, "not_enrolled", "報名並開通這門課之後才能交作業");
  if (a.opens_at && a.opens_at > now()) h.fail(409, "not_open", `這份作業 ${fmtDate(a.opens_at)} 才開放繳交`);
  let s = await h.db.prepare("SELECT * FROM hw_submissions WHERE assignment_id = ? AND member_sub = ?").bind(a.id, me.sub).first<SRow>();
  if (!s) {
    await h.db.prepare("INSERT OR IGNORE INTO hw_submissions (id, assignment_id, course_id, member_sub, member_name, status) VALUES (?, ?, ?, ?, ?, 'draft')").bind(rid(), a.id, a.course_id, me.sub, me.name.slice(0, 60)).run();
    s = await h.db.prepare("SELECT * FROM hw_submissions WHERE assignment_id = ? AND member_sub = ?").bind(a.id, me.sub).first<SRow>();
  }
  if (!s) return h.fail(500, "submission_failed", "建立作業失敗，請再試一次");
  if (s.status === "graded") h.fail(409, "graded", "老師已經評分，不能再修改");
  return s;
}
async function mineView(h: HwDeps, a: ARow): Promise<HwSubmission | null> {
  const me = need(h);
  const s = await h.db.prepare("SELECT * FROM hw_submissions WHERE assignment_id = ? AND member_sub = ?").bind(a.id, me.sub).first<SRow>();
  return s ? submissionView(h, s, a, await roleOf(h, a.course_id)) : null;
}
async function fileCount(db: D1Database, sid: string): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM hw_files WHERE submission_id = ?").bind(sid).first<{ n: number }>())?.n ?? 0;
}
const touch = (db: D1Database, sid: string) => db.prepare("UPDATE hw_submissions SET updated_at = ? WHERE id = ?").bind(now(), sid);

async function assignmentView(h: HwDeps, a: ARow): Promise<HwAssignmentView> {
  const me = need(h);
  const r = await roleOf(h, a.course_id);
  requireIn(h, r);
  const [course, list, subs, groups] = await Promise.all([
    courseOf(h, a.course_id),
    r.teacher || r.groupId ? members(h.db, a.course_id) : Promise.resolve([] as MemberRow[]),
    h.db.prepare("SELECT * FROM hw_submissions WHERE assignment_id = ?").bind(a.id).all<SRow>(),
    h.db.prepare("SELECT id, name FROM hw_groups WHERE course_id = ? ORDER BY position, created_at").bind(a.course_id).all<{ id: string; name: string }>(),
  ]);
  const bySub = new Map(subs.results.map((s) => [s.member_sub, s]));
  const leading = !!r.leaderOf;
  // 老師看全部；組長看自己這組；一般組員只看同組「已送出」的（看不到分數）。
  const visible = list.filter((m) => r.teacher || (m.group_id && m.group_id === r.groupId && m.sub !== me.sub && (leading || (bySub.get(m.sub) && bySub.get(m.sub)!.status !== "draft"))));
  const roster: HwRosterRow[] = visible.map((m) => {
    const s = bySub.get(m.sub);
    const st = statusOf(s);
    const showDraft = r.teacher || leading;
    return {
      sub: m.sub,
      name: m.name,
      avatar: m.avatar,
      groupId: m.group_id,
      groupName: m.group_name,
      leader: m.is_leader === 1,
      status: st === "draft" && showDraft ? "none" : st,
      submissionId: s && s.status !== "draft" ? s.id : null,
      submittedAt: s?.submitted_at ?? null,
      late: isLate(a, s),
      result: r.teacher || leading ? resultOf(s) : null,
    };
  });
  const counted = new Set((r.teacher ? list : list.filter((m) => leading && m.group_id === r.leaderOf)).map((m) => m.sub));
  const mine = bySub.get(me.sub);
  return {
    assignment: toAssignment(a, mine ?? null, r.teacher || leading ? countsOf(subs.results, counted) : null),
    course,
    role: r,
    mine: mine ? await submissionView(h, mine, a, r) : null,
    roster,
    groups: groups.results,
  };
}

// ---------- 分組 ----------
async function groupsView(h: HwDeps, courseId: string): Promise<HwGroupsView> {
  const r = await roleOf(h, courseId);
  requireIn(h, r);
  const [list, gs] = await Promise.all([members(h.db, courseId), h.db.prepare("SELECT id, name FROM hw_groups WHERE course_id = ? ORDER BY position, created_at").bind(courseId).all<{ id: string; name: string }>()]);
  const m = (x: MemberRow): HwGroupMember => ({ sub: x.sub, name: x.name, avatar: x.avatar, leader: x.is_leader === 1 });
  const groups = gs.results.map((g) => ({ id: g.id, name: g.name, members: list.filter((x) => x.group_id === g.id).map(m) }));
  // 一般學員只看得到自己這組（組名單不公開）；組長另外看得到還沒分組的人（才能拉進來）。
  const seen = r.teacher ? groups : groups.filter((g) => g.id === r.groupId);
  return { groups: seen, ungrouped: r.teacher || r.leaderOf ? list.filter((x) => !x.group_id).map(m) : [], canEdit: r.teacher || !!r.leaderOf, teacher: r.teacher, leaderOf: r.leaderOf, myGroupId: r.groupId };
}

// ---------- 給「學習中」的我的作業 ----------
async function myHomework(h: HwDeps): Promise<MyHomework> {
  const me = need(h);
  const t = now();
  const { results } = await h.db
    .prepare(
      `SELECT a.id, a.course_id, a.title, a.grading, a.max_score, a.opens_at, a.due_at, c.title AS course_title,
              s.status, s.score, s.stars, s.passed, s.comment, s.graded_by_name, s.graded_at, s.updated_at
       FROM hw_assignments a
       JOIN enrollments e ON e.course_id = a.course_id AND e.member_sub = ?
       JOIN courses c ON c.id = a.course_id
       LEFT JOIN hw_submissions s ON s.assignment_id = a.id AND s.member_sub = e.member_sub
       WHERE a.opens_at IS NULL OR a.opens_at <= ?`,
    )
    .bind(me.sub, t)
    .all<{ id: string; course_id: string; title: string; grading: string; max_score: number; opens_at: string | null; due_at: string | null; course_title: string; status: string | null; score: number | null; stars: number | null; passed: number | null; comment: string | null; graded_by_name: string | null; graded_at: string | null; updated_at: string | null }>();
  const recent = new Date(Date.now() - 45 * 86400_000).toISOString();
  const items: MyHomeworkItem[] = results
    .map((x) => {
      const s = x.status ? ({ ...x, status: x.status, comment: x.comment ?? "", graded_by_name: x.graded_by_name ?? "" } as unknown as SRow) : null;
      return { x, item: { assignmentId: x.id, courseId: x.course_id, courseTitle: x.course_title, title: x.title, dueAt: x.due_at, overdue: !!x.due_at && x.due_at < t, status: statusOf(s), result: resultOf(s), grading: gradingOf(x.grading), maxScore: x.max_score } };
    })
    .filter(({ x, item }) => item.status !== "graded" || (x.graded_at ?? "") > recent)
    .map(({ item }) => item);
  const rank = (s: HwStatus) => (s === "returned" ? 0 : s === "none" || s === "draft" ? 1 : s === "submitted" ? 2 : 3);
  items.sort((a, b) => rank(a.status) - rank(b.status) || (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"));
  // 老師：有學員送出、等待批改的作業。
  const pend = await h.db
    .prepare("SELECT a.id, a.course_id, a.title, c.title AS course_title, COUNT(*) AS n FROM hw_submissions s JOIN hw_assignments a ON a.id = s.assignment_id JOIN courses c ON c.id = a.course_id WHERE s.status = 'submitted' GROUP BY a.id ORDER BY MIN(s.submitted_at) LIMIT 40")
    .all<{ id: string; course_id: string; title: string; course_title: string; n: number }>();
  const teach = new Map<string, boolean>();
  const toGrade: MyHomework["toGrade"] = [];
  for (const p of pend.results) {
    if (!teach.has(p.course_id)) teach.set(p.course_id, await h.isTeacher(p.course_id));
    if (teach.get(p.course_id)) toGrade.push({ courseId: p.course_id, courseTitle: p.course_title, assignmentId: p.id, title: p.title, count: p.n });
    if (toGrade.length >= 10) break;
  }
  return { items: items.slice(0, 20), todo: items.filter((i) => rank(i.status) <= 1).length, toGrade };
}

// ---------- 檔案讀取 ----------
async function serveFile(h: HwDeps): Promise<Response> {
  const v = await verifyFileUrl(h.env, h.url);
  const bucket = h.env.MEDIA;
  if (!v || !bucket) return new Response("連結已失效，請回到行動大學重新打開作業。", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  const head = await bucket.head(v.key);
  if (!head) return new Response("檔案已經不存在。", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const size = head.size;
  const headers: Record<string, string> = {
    "content-type": head.httpMetadata?.contentType ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
    ...(v.name ? { "content-disposition": `${h.url.searchParams.get("dl") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(v.name)}` } : {}),
  };
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.req.headers.get("range") ?? "");
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const part = await bucket.get(v.key, { range: { offset: start, length: end - start + 1 } });
    if (!part) return new Response("Not found", { status: 404 });
    return new Response(part.body, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  const obj = await bucket.get(v.key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, { headers: { ...headers, "content-length": String(size) } });
}

async function deleteKeys(env: Env, keys: (string | null)[]): Promise<void> {
  for (const k of keys) if (k) await env.MEDIA?.delete(k).catch(() => undefined);
}

export const HW_ROUTES: Route[] = [
  ["GET", /^\/homework\/mine$/, (h) => myHomework(h)],
  ["GET", /^\/homework\/file$/, (h) => serveFile(h)],
  [
    "GET",
    /^\/homework\/course\/([\w-]{1,80})$/,
    async (h, [courseId]) => {
      const course = await courseOf(h, courseId!);
      const r = await roleOf(h, courseId!);
      requireIn(h, r);
      const me = need(h);
      const [as, subs, list] = await Promise.all([
        h.db.prepare("SELECT * FROM hw_assignments WHERE course_id = ? ORDER BY COALESCE(opens_at, created_at), created_at").bind(courseId).all<ARow>(),
        h.db.prepare("SELECT * FROM hw_submissions WHERE course_id = ?").bind(courseId).all<SRow>(),
        r.teacher || r.leaderOf ? members(h.db, courseId!) : Promise.resolve([] as MemberRow[]),
      ]);
      const counted = new Set((r.teacher ? list : list.filter((m) => m.group_id === r.leaderOf)).map((m) => m.sub));
      const assignments = as.results.map((a) => {
        const sa = subs.results.filter((s) => s.assignment_id === a.id);
        return toAssignment(a, sa.find((s) => s.member_sub === me.sub) ?? null, r.teacher || r.leaderOf ? countsOf(sa, counted) : null);
      });
      return { course, role: r, assignments } satisfies HwCourseView;
    },
  ],
  [
    "POST",
    /^\/homework\/course\/([\w-]{1,80})\/assignments$/,
    async (h, [courseId]) => {
      const me = need(h);
      const course = await courseOf(h, courseId!);
      requireTeacher(h, await roleOf(h, courseId!));
      const v = readAssignment(h, await body<Record<string, unknown>>(h));
      const id = rid();
      await h.db
        .prepare("INSERT INTO hw_assignments (id, course_id, title, body, kinds, grading, max_score, opens_at, due_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, courseId, v.title, v.body, v.kinds, v.grading, v.maxScore, v.opensAt, v.dueAt, me.sub)
        .run();
      // 通知這門課所有已開通的學員。
      const { results } = await h.db.prepare("SELECT member_sub FROM enrollments WHERE course_id = ?").bind(courseId).all<{ member_sub: string }>();
      const when = v.opensAt && v.opensAt > now() ? `${fmtDate(v.opensAt)} 開放繳交` : v.dueAt ? `截止 ${fmtDate(v.dueAt)}` : "現在就可以繳交";
      const notes = results.map((x) => h.notify(x.member_sub, `新作業：${v.title}`, `${course.title}・${when}`, `/homework/a/${id}`));
      for (let i = 0; i < notes.length; i += 50) await h.db.batch(notes.slice(i, i + 50));
      return { id };
    },
  ],
  [
    "GET",
    /^\/homework\/a\/([\w-]{1,40})$/,
    async (h, [id]) => assignmentView(h, await assignmentRow(h, id!)),
  ],
  [
    "PATCH",
    /^\/homework\/a\/([\w-]{1,40})$/,
    async (h, [id]) => {
      const a = await assignmentRow(h, id!);
      requireTeacher(h, await roleOf(h, a.course_id));
      const v = readAssignment(h, await body<Record<string, unknown>>(h), a);
      await h.db.prepare("UPDATE hw_assignments SET title = ?, body = ?, kinds = ?, grading = ?, max_score = ?, opens_at = ?, due_at = ?, updated_at = ? WHERE id = ?").bind(v.title, v.body, v.kinds, v.grading, v.maxScore, v.opensAt, v.dueAt, now(), a.id).run();
      return assignmentView(h, await assignmentRow(h, a.id));
    },
  ],
  [
    "DELETE",
    /^\/homework\/a\/([\w-]{1,40})$/,
    async (h, [id]) => {
      const a = await assignmentRow(h, id!);
      requireTeacher(h, await roleOf(h, a.course_id));
      const { results } = await h.db.prepare("SELECT f.r2_key, f.poster_key FROM hw_files f JOIN hw_submissions s ON s.id = f.submission_id WHERE s.assignment_id = ?").bind(a.id).all<{ r2_key: string | null; poster_key: string | null }>();
      await h.db.batch([
        h.db.prepare("DELETE FROM hw_comments WHERE submission_id IN (SELECT id FROM hw_submissions WHERE assignment_id = ?)").bind(a.id),
        h.db.prepare("DELETE FROM hw_files WHERE submission_id IN (SELECT id FROM hw_submissions WHERE assignment_id = ?)").bind(a.id),
        h.db.prepare("DELETE FROM hw_submissions WHERE assignment_id = ?").bind(a.id),
        h.db.prepare("DELETE FROM hw_assignments WHERE id = ?").bind(a.id),
      ]);
      await deleteKeys(h.env, results.flatMap((r) => [r.r2_key, r.poster_key]));
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/homework\/a\/([\w-]{1,40})\/remind$/,
    async (h, [id]) => {
      // 老師按「提醒還沒交的人」：還沒送出、或被退回的學員收到通知。
      const a = await assignmentRow(h, id!);
      requireTeacher(h, await roleOf(h, a.course_id));
      const { results } = await h.db
        .prepare("SELECT e.member_sub FROM enrollments e LEFT JOIN hw_submissions s ON s.assignment_id = ? AND s.member_sub = e.member_sub WHERE e.course_id = ? AND (s.id IS NULL OR s.status IN ('draft', 'returned'))")
        .bind(a.id, a.course_id)
        .all<{ member_sub: string }>();
      const notes = results.map((x) => h.notify(x.member_sub, `記得交作業：${a.title}`, a.due_at ? `截止 ${fmtDate(a.due_at)}` : "老師提醒你繳交作業", `/homework/a/${a.id}`));
      for (let i = 0; i < notes.length; i += 50) await h.db.batch(notes.slice(i, i + 50));
      return { count: results.length };
    },
  ],
  [
    "POST",
    /^\/homework\/a\/([\w-]{1,40})\/files$/,
    async (h, [id]) => {
      // 學員上傳一個檔案：?kind=image|video|file&name=&w=&h=&dur=（照片、影片已在學員的瀏覽器壓縮過）。
      const a = await assignmentRow(h, id!);
      const kind = h.url.searchParams.get("kind") ?? "";
      if (kind !== "image" && kind !== "video" && kind !== "file") return h.fail(400, "invalid_kind", "不支援這種檔案");
      if (!kindsOf(a.kinds).includes(kind)) h.fail(400, "kind_not_allowed", `這份作業不收${HW_KINDS.find((k) => k.key === kind)?.label}`);
      const s = await editableSubmission(h, a);
      if ((await fileCount(h.db, s.id)) >= HW_LIMITS.files) h.fail(409, "too_many", `每份作業最多 ${HW_LIMITS.files} 個檔案或連結`);
      const bucket = h.env.MEDIA ?? h.fail(503, "storage_not_ready", "檔案儲存空間尚未啟用");
      const data = new Uint8Array(await h.req.arrayBuffer());
      if (!data.byteLength) h.fail(400, "empty", "沒有收到檔案");
      let name = str(h.url.searchParams.get("name"), 120) || "檔案";
      let ct = "";
      let ext = "";
      const dur = Math.round(Number(h.url.searchParams.get("dur")) || 0);
      if (kind === "image") {
        const img = sniffImage(data) ?? h.fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 照片");
        if (data.byteLength > HW_LIMITS.imageMb * MB) h.fail(413, "too_large", `照片超過 ${HW_LIMITS.imageMb}MB`);
        ct = img.type;
        ext = img.ext;
      } else if (kind === "video") {
        const isMp4 = data.byteLength > 12 && String.fromCharCode(data[4]!, data[5]!, data[6]!, data[7]!) === "ftyp";
        const isWebm = data.byteLength > 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3;
        if (!isMp4 && !isWebm) h.fail(400, "invalid_video", "請上傳 MP4 或 WebM 影片");
        if (dur > HW_VIDEO.maxSec + 3) h.fail(413, "video_too_long", `影片最長 ${HW_VIDEO.maxSec / 60} 分鐘`);
        if (data.byteLength > HW_VIDEO.maxMb * MB) h.fail(413, "too_large", `影片壓縮後仍超過 ${HW_VIDEO.maxMb}MB，請剪短一點再上傳`);
        ct = isMp4 ? "video/mp4" : "video/webm";
        ext = isMp4 ? "mp4" : "webm";
      } else {
        const k = classifyFile(name);
        if (k === "video") return h.fail(400, "use_video", "影片請用「短影片」上傳（會自動壓縮）");
        if (!k) return h.fail(400, "invalid_file", "不支援這種檔案，請上傳 PDF、Word、Excel、簡報、文字檔或圖片");
        if (data.byteLength > HW_LIMITS.fileMb * MB) h.fail(413, "too_large", `檔案超過 ${HW_LIMITS.fileMb}MB`);
        ct = k.ct;
        ext = (/\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1] ?? "bin").toLowerCase();
      }
      if (kind !== "file") name = name.replace(/\.[^.]+$/, "") || (kind === "image" ? "照片" : "影片");
      const key = `hw/${a.id}/${crypto.randomUUID()}.${ext}`;
      await bucket.put(key, data.buffer as ArrayBuffer, { httpMetadata: { contentType: ct } });
      const dim = (v: string | null) => Math.max(0, Math.min(20000, Math.round(Number(v) || 0)));
      const fid = rid();
      const pos = await fileCount(h.db, s.id);
      await h.db.batch([
        h.db.prepare("INSERT INTO hw_files (id, submission_id, kind, name, r2_key, content_type, size, width, height, duration_sec, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(fid, s.id, kind, name, key, ct, data.byteLength, dim(h.url.searchParams.get("w")), dim(h.url.searchParams.get("h")), Math.min(dur, 600), pos),
        touch(h.db, s.id),
      ]);
      return { id: fid, mine: await mineView(h, a) };
    },
  ],
  [
    "PUT",
    /^\/homework\/files\/([\w-]{1,40})\/poster$/,
    async (h, [id]) => {
      // 短影片的預覽圖（學員瀏覽器擷取的一格畫面）。
      const me = need(h);
      const f = await h.db.prepare("SELECT f.id, f.kind, f.poster_key, s.member_sub, s.assignment_id FROM hw_files f JOIN hw_submissions s ON s.id = f.submission_id WHERE f.id = ?").bind(id).first<{ id: string; kind: string; poster_key: string | null; member_sub: string; assignment_id: string }>();
      if (!f || f.member_sub !== me.sub || f.kind !== "video") return h.fail(404, "not_found", "找不到這支影片");
      const data = new Uint8Array(await h.req.arrayBuffer());
      const img = sniffImage(data) ?? h.fail(400, "invalid_image", "預覽圖格式不正確");
      if (data.byteLength > 3 * MB) h.fail(413, "too_large", "預覽圖太大");
      const key = `hw/${f.assignment_id}/${crypto.randomUUID()}.${img.ext}`;
      await h.env.MEDIA?.put(key, data.buffer as ArrayBuffer, { httpMetadata: { contentType: img.type } });
      await h.db.prepare("UPDATE hw_files SET poster_key = ? WHERE id = ?").bind(key, f.id).run();
      await deleteKeys(h.env, [f.poster_key]);
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/homework\/a\/([\w-]{1,40})\/link$/,
    async (h, [id]) => {
      const a = await assignmentRow(h, id!);
      if (!kindsOf(a.kinds).includes("link")) h.fail(400, "kind_not_allowed", "這份作業不收連結");
      const b = await body<{ url?: unknown; name?: unknown }>(h);
      const u = parseHttpsUrl(b.url) ?? h.fail(400, "invalid_url", "請貼上以 https:// 開頭的完整網址");
      const s = await editableSubmission(h, a);
      if ((await fileCount(h.db, s.id)) >= HW_LIMITS.files) h.fail(409, "too_many", `每份作業最多 ${HW_LIMITS.files} 個檔案或連結`);
      const name = str(b.name, 120) || u.hostname.replace(/^www\./, "");
      await h.db.batch([
        h.db.prepare("INSERT INTO hw_files (id, submission_id, kind, name, link_url, position) VALUES (?, ?, 'link', ?, ?, ?)").bind(rid(), s.id, name, u.toString(), await fileCount(h.db, s.id)),
        touch(h.db, s.id),
      ]);
      return { mine: await mineView(h, a) };
    },
  ],
  [
    "DELETE",
    /^\/homework\/files\/([\w-]{1,40})$/,
    async (h, [id]) => {
      const me = need(h);
      const f = await h.db.prepare("SELECT f.id, f.r2_key, f.poster_key, s.id AS sid, s.member_sub, s.status, s.assignment_id FROM hw_files f JOIN hw_submissions s ON s.id = f.submission_id WHERE f.id = ?").bind(id).first<{ id: string; r2_key: string | null; poster_key: string | null; sid: string; member_sub: string; status: string; assignment_id: string }>();
      if (!f || f.member_sub !== me.sub) return h.fail(404, "not_found", "找不到這個檔案");
      if (f.status === "graded") h.fail(409, "graded", "老師已經評分，不能再修改");
      await h.db.batch([h.db.prepare("DELETE FROM hw_files WHERE id = ?").bind(f.id), touch(h.db, f.sid)]);
      await deleteKeys(h.env, [f.r2_key, f.poster_key]);
      return { mine: await mineView(h, await assignmentRow(h, f.assignment_id)) };
    },
  ],
  [
    "POST",
    /^\/homework\/a\/([\w-]{1,40})\/submit$/,
    async (h, [id]) => {
      // 送出（或修改後重新送出）：至少要有一個檔案、連結，或（作業收文字時）一段文字。
      const a = await assignmentRow(h, id!);
      const b = await body<{ note?: unknown }>(h);
      const note = str(b.note, HW_LIMITS.noteChars);
      const s = await editableSubmission(h, a);
      const n = await fileCount(h.db, s.id);
      const textOk = kindsOf(a.kinds).includes("text") && !!note;
      if (!n && !textOk) h.fail(400, "empty", kindsOf(a.kinds).includes("text") ? "請先放上檔案，或寫一段文字再送出" : "請先放上至少一個檔案再送出");
      const t = now();
      await h.db.prepare("UPDATE hw_submissions SET note = ?, status = 'submitted', submitted_at = ?, updated_at = ?, member_name = ? WHERE id = ?").bind(note, t, t, need(h).name.slice(0, 60), s.id).run();
      return { mine: await mineView(h, a) };
    },
  ],
  [
    "GET",
    /^\/homework\/s\/([\w-]{1,40})$/,
    async (h, [id]) => {
      need(h);
      const s = await h.db.prepare("SELECT * FROM hw_submissions WHERE id = ?").bind(id).first<SRow>();
      if (!s) return h.fail(404, "not_found", "找不到這份作業");
      const a = await assignmentRow(h, s.assignment_id);
      const [sub, course] = await Promise.all([submissionView(h, s, a, await roleOf(h, s.course_id)), courseOf(h, s.course_id)]);
      return { submission: sub, assignment: toAssignment(a, null, null), course };
    },
  ],
  [
    "POST",
    /^\/homework\/s\/([\w-]{1,40})\/grade$/,
    async (h, [id]) => {
      // 老師評分：action＝grade（評分）／return（退回重交）。分數制填 score、星星制填 stars（1～5）、通過制 grade＝通過。
      const me = need(h);
      const s = await h.db.prepare("SELECT * FROM hw_submissions WHERE id = ?").bind(id).first<SRow>();
      if (!s || s.status === "draft") return h.fail(404, "not_found", "找不到這份作業（學員還沒送出）");
      const a = await assignmentRow(h, s.assignment_id);
      requireTeacher(h, await roleOf(h, s.course_id));
      const b = await body<{ action?: unknown; score?: unknown; stars?: unknown; comment?: unknown }>(h);
      const comment = str(b.comment, HW_LIMITS.commentChars);
      const g = gradingOf(a.grading);
      const t = now();
      if (b.action === "return") {
        if (!comment) h.fail(400, "need_comment", "退回重交時，請寫一句話告訴學員要怎麼改");
        await h.db.batch([
          h.db.prepare("UPDATE hw_submissions SET status = 'returned', score = NULL, stars = NULL, passed = 0, comment = ?, graded_by_name = ?, graded_at = ?, updated_at = ? WHERE id = ?").bind(comment, me.name.slice(0, 60), t, t, s.id),
          h.notify(s.member_sub, `作業需要重交：${a.title}`, comment.slice(0, 80), `/homework/a/${a.id}`),
        ]);
      } else {
        let score: number | null = null;
        let stars: number | null = null;
        if (g === "score") {
          score = Number(b.score);
          if (!Number.isInteger(score) || score < 0 || score > a.max_score) h.fail(400, "invalid_score", `分數請填 0～${a.max_score} 的整數`);
        } else if (g === "stars") {
          stars = Number(b.stars);
          if (!Number.isInteger(stars) || stars < 1 || stars > 5) h.fail(400, "invalid_stars", "請選 1～5 顆星");
        }
        await h.db.batch([
          h.db.prepare("UPDATE hw_submissions SET status = 'graded', score = ?, stars = ?, passed = ?, comment = ?, graded_by_name = ?, graded_at = ?, updated_at = ? WHERE id = ?").bind(score, stars, g === "pass" ? 1 : null, comment, me.name.slice(0, 60), t, t, s.id),
          h.notify(s.member_sub, `作業已批改：${a.title}`, resultText(g, a.max_score, { score, stars, passed: 1 }), `/homework/a/${a.id}`),
        ]);
      }
      const next = await h.db.prepare("SELECT id FROM hw_submissions WHERE assignment_id = ? AND status = 'submitted' AND id <> ? ORDER BY submitted_at LIMIT 1").bind(a.id, s.id).first<{ id: string }>();
      return { ok: true, next: next?.id ?? null };
    },
  ],
  [
    "POST",
    /^\/homework\/s\/([\w-]{1,40})\/comments$/,
    async (h, [id]) => {
      const me = need(h);
      const s = await h.db.prepare("SELECT * FROM hw_submissions WHERE id = ?").bind(id).first<SRow>();
      if (!s) return h.fail(404, "not_found", "找不到這份作業");
      const a = await assignmentRow(h, s.assignment_id);
      const r = await roleOf(h, s.course_id);
      const view = await submissionView(h, s, a, r);
      if (!view.canComment) h.fail(403, "forbidden", "只有本人、組長和老師可以留言");
      const text = str((await body<{ body?: unknown }>(h)).body, HW_LIMITS.commentChars);
      if (!text) h.fail(400, "empty", "請輸入留言");
      const role = r.teacher ? "teacher" : s.member_sub === me.sub ? "student" : "leader";
      const stmts = [h.db.prepare("INSERT INTO hw_comments (id, submission_id, author_sub, author_name, role, body) VALUES (?, ?, ?, ?, ?, ?)").bind(rid(), s.id, me.sub, me.name.slice(0, 60), role, text)];
      if (s.member_sub !== me.sub) stmts.push(h.notify(s.member_sub, `${role === "teacher" ? "老師" : "組長"}在你的作業留言：${a.title}`, text.slice(0, 80), `/homework/a/${a.id}`));
      await h.db.batch(stmts);
      return submissionView(h, s, a, r);
    },
  ],
  [
    "GET",
    /^\/homework\/course\/([\w-]{1,80})\/groups$/,
    async (h, [courseId]) => {
      await courseOf(h, courseId!);
      return groupsView(h, courseId!);
    },
  ],
  [
    "POST",
    /^\/homework\/course\/([\w-]{1,80})\/groups$/,
    async (h, [courseId]) => {
      await courseOf(h, courseId!);
      requireTeacher(h, await roleOf(h, courseId!));
      const name = str((await body<{ name?: unknown }>(h)).name, 30);
      if (!name) h.fail(400, "invalid_name", "請輸入組名");
      const pos = (await h.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM hw_groups WHERE course_id = ?").bind(courseId).first<{ p: number }>())?.p ?? 0;
      await h.db.prepare("INSERT INTO hw_groups (id, course_id, name, position) VALUES (?, ?, ?, ?)").bind(rid(), courseId, name, pos).run();
      return groupsView(h, courseId!);
    },
  ],
  [
    "PATCH",
    /^\/homework\/groups\/([\w-]{1,40})$/,
    async (h, [id]) => {
      const g = await h.db.prepare("SELECT id, course_id FROM hw_groups WHERE id = ?").bind(id).first<{ id: string; course_id: string }>();
      if (!g) return h.fail(404, "not_found", "找不到這一組");
      const r = await roleOf(h, g.course_id);
      if (!r.teacher && r.leaderOf !== g.id) h.fail(403, "forbidden", "只有老師和這一組的組長可以改組名");
      const name = str((await body<{ name?: unknown }>(h)).name, 30);
      if (!name) h.fail(400, "invalid_name", "請輸入組名");
      await h.db.prepare("UPDATE hw_groups SET name = ? WHERE id = ?").bind(name, g.id).run();
      return groupsView(h, g.course_id);
    },
  ],
  [
    "DELETE",
    /^\/homework\/groups\/([\w-]{1,40})$/,
    async (h, [id]) => {
      const g = await h.db.prepare("SELECT id, course_id FROM hw_groups WHERE id = ?").bind(id).first<{ id: string; course_id: string }>();
      if (!g) return h.fail(404, "not_found", "找不到這一組");
      requireTeacher(h, await roleOf(h, g.course_id));
      await h.db.batch([h.db.prepare("DELETE FROM hw_group_members WHERE group_id = ?").bind(g.id), h.db.prepare("DELETE FROM hw_groups WHERE id = ?").bind(g.id)]);
      return groupsView(h, g.course_id);
    },
  ],
  [
    "PUT",
    /^\/homework\/course\/([\w-]{1,80})\/member$/,
    async (h, [courseId]) => {
      // 換組、移出、設組長：{ sub, groupId（null＝移出分組）, leader }。老師都可以；組長只能把還沒分組的人拉進自己這組、或把組員移出自己這組。
      const me = need(h);
      await courseOf(h, courseId!);
      const r = await roleOf(h, courseId!);
      const b = await body<{ sub?: unknown; groupId?: unknown; leader?: unknown }>(h);
      const sub = str(b.sub, 120);
      const groupId = typeof b.groupId === "string" && b.groupId ? b.groupId : null;
      const ok = await h.db.prepare("SELECT 1 AS ok FROM enrollments WHERE member_sub = ? AND course_id = ?").bind(sub, courseId).first();
      if (!ok) h.fail(404, "not_enrolled", "這位學員沒有開通這門課");
      if (groupId && !(await h.db.prepare("SELECT 1 AS ok FROM hw_groups WHERE id = ? AND course_id = ?").bind(groupId, courseId).first())) h.fail(404, "not_found", "找不到這一組");
      const cur = await h.db.prepare("SELECT group_id, is_leader FROM hw_group_members WHERE course_id = ? AND member_sub = ?").bind(courseId, sub).first<{ group_id: string; is_leader: number }>();
      if (!r.teacher) {
        if (!r.leaderOf) h.fail(403, "forbidden", "只有老師和組長可以編組");
        if (b.leader !== undefined) h.fail(403, "forbidden", "只有老師可以指定組長");
        if (sub === me.sub) h.fail(400, "self", "組長不能把自己移出");
        const joining = !cur && groupId === r.leaderOf;
        const leaving = cur?.group_id === r.leaderOf && !groupId;
        if (!joining && !leaving) h.fail(403, "forbidden", "組長只能把還沒分組的學員拉進自己這組，或把組員移出");
      }
      const leader = b.leader === true ? 1 : b.leader === false ? 0 : cur && cur.group_id === groupId ? cur.is_leader : 0;
      const stmts: D1PreparedStatement[] = [];
      if (!groupId) stmts.push(h.db.prepare("DELETE FROM hw_group_members WHERE course_id = ? AND member_sub = ?").bind(courseId, sub));
      else {
        if (leader) stmts.push(h.db.prepare("UPDATE hw_group_members SET is_leader = 0 WHERE group_id = ?").bind(groupId)); // 一組一位組長
        stmts.push(h.db.prepare("INSERT INTO hw_group_members (course_id, member_sub, group_id, is_leader) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(course_id, member_sub) DO UPDATE SET group_id = ?3, is_leader = ?4").bind(courseId, sub, groupId, leader));
      }
      await h.db.batch(stmts);
      return groupsView(h, courseId!);
    },
  ],
];

/** 儲存空間統計：作業檔案歸屬到該課程的主辦中心。 */
export async function homeworkStorageOwners(db: D1Database): Promise<{ key: string; courseId: string }[]> {
  const { results } = await db.prepare("SELECT s.course_id, f.r2_key, f.poster_key FROM hw_files f JOIN hw_submissions s ON s.id = f.submission_id WHERE f.r2_key IS NOT NULL").all<{ course_id: string; r2_key: string; poster_key: string | null }>();
  return results.flatMap((r) => [{ key: r.r2_key, courseId: r.course_id }, ...(r.poster_key ? [{ key: r.poster_key, courseId: r.course_id }] : [])]);
}
