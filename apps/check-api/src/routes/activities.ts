/** 寰宇繳作業系統 API 網址：作業活動、堂與項目、加入（杜杜龍 2026-11-27 從 api.ts 拆出；這個檔被載入時就把網址登記進路由表）。 */
import { DEFAULT_KINDS, KINDS, pointsFor, type ItemMode } from "../contract.ts";
import { type Row, access, body, bool, deleteR2, dueAt, fail, itemCard, membership, needManager, needTeacher, notify, num, on, rid, str, superAdmin } from "../core.ts";

// 堂與項目
on("POST", "/activities/:id/lessons", async (c, [id], req) => {
  needManager(await access(c, id));
  const b = await body(req);
  const max = Number((await c.env.DB.prepare("SELECT COALESCE(MAX(position), 0) AS p FROM lessons WHERE activity_id = ?").bind(id).first<Row>())?.p ?? 0);
  const lid = rid();
  await c.env.DB.prepare("INSERT INTO lessons (id, activity_id, position, title, due_at) VALUES (?, ?, ?, ?, ?)").bind(lid, id, max + 1, str(b.title, 40) || `第 ${max + 1} 堂`, dueAt(b.dueAt)).run();
  return { id: lid };
});
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

export function itemFields(b: Row, base?: Row): Row {
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
      const managers = (await db.prepare("SELECT member_id FROM members WHERE activity_id = ? AND status = 'active' AND (role = 'manager' OR (? IS NOT NULL AND group_id = ? AND is_leader = 1))").bind(act!.id, g ? g.id : null, g ? g.id : null).all<Row>()).results.map((r) => String(r.member_id));
      await notify(db, managers, "有人申請加入", `「${act!.title}」有新的加入申請，請到分組頁核准。`, `/groups/${act!.id}`);
    }
  } else if (g && existing.role === "student" && !existing.group_id) {
    await db.prepare("UPDATE members SET group_id = ? WHERE activity_id = ? AND member_id = ?").bind(g.id, act!.id, c.sub).run();
  }
  const m = await membership(db, String(act!.id), c.sub);
  return { activityId: act!.id, status: m?.status ?? status };
});
on("POST", "/activities/:id/invites", async (c, [id], req) => {
  const a = await access(c, id);
  const b = await body(req);
  const want = str(b.role, 10);
  if (want === "leader") {
    // 組長邀請：老師以上可以發，7 天內有效、只能一人使用；接受後直接成為這一組的組長（不用再等核准）
    needTeacher(a);
    const groupId = str(b.groupId, 40);
    const g = await c.env.DB.prepare("SELECT id FROM groups WHERE id = ? AND activity_id = ?").bind(groupId, id).first<Row>();
    if (!g) fail(404, "找不到這一組");
    const code = rid(16);
    await c.env.DB.prepare("INSERT INTO invites (code, activity_id, role, expires_at, created_by, group_id) VALUES (?, ?, 'leader', ?, ?, ?)").bind(code, id, new Date(Date.now() + 7 * 86400_000).toISOString(), c.sub, groupId).run();
    return { code, role: "leader" };
  }
  needManager(a);
  const role = want === "manager" ? "manager" : "teacher";
  const code = rid(16);
  await c.env.DB.prepare("INSERT INTO invites (code, activity_id, role, expires_at, created_by) VALUES (?, ?, ?, ?, ?)").bind(code, id, role, new Date(Date.now() + 86400_000).toISOString(), c.sub).run();
  return { code, role };
});
on("GET", "/invite/:code", async (c, [code]) => {
  const inv = await c.env.DB.prepare("SELECT i.role, i.used_by, i.expires_at, a.title, g.name AS group_name FROM invites i JOIN activities a ON a.id = i.activity_id LEFT JOIN groups g ON g.id = i.group_id WHERE i.code = ?").bind(code).first<Row>();
  if (!inv) fail(404, "找不到這個邀請");
  const valid = !inv!.used_by && Date.parse(String(inv!.expires_at)) >= Date.now();
  return { role: String(inv!.role), title: String(inv!.title), groupName: (inv!.group_name as string) ?? null, valid, usedByMe: inv!.used_by === c.sub };
});
on("POST", "/invite/:code", async (c, [code]) => {
  const db = c.env.DB;
  const inv = await db.prepare("SELECT * FROM invites WHERE code = ?").bind(code).first<Row>();
  if (!inv || inv.used_by || Date.parse(String(inv.expires_at)) < Date.now()) fail(410, inv?.role === "leader" ? "這個組長邀請已失效（7 天內、只能一人使用），請向老師索取新的" : "這個邀請已失效（24 小時內、只能一人使用）");
  const ok = await db.prepare("UPDATE invites SET used_by = ? WHERE code = ? AND used_by IS NULL").bind(c.sub, code).run();
  if (!ok.meta?.changes) fail(410, "這個邀請已被使用");
  if (inv!.role === "leader") {
    const me = await db.prepare("SELECT role FROM members WHERE activity_id = ? AND member_id = ? AND status = 'active'").bind(inv!.activity_id, c.sub).first<Row>();
    if (me && me.role !== "student") {
      await db.prepare("UPDATE invites SET used_by = NULL WHERE code = ?").bind(code).run();
      fail(400, "你在這份作業已經是老師或管理員，不能再當組長；請把連結交給要當組長的人");
    }
    const g = await db.prepare("SELECT id, name FROM groups WHERE id = ?").bind(inv!.group_id).first<Row>();
    if (!g) fail(404, "這一組已被刪除，請向老師索取新的邀請");
    const act = await db.prepare("SELECT title FROM activities WHERE id = ?").bind(inv!.activity_id).first<Row>();
    await db.batch([
      db.prepare("UPDATE members SET is_leader = 0 WHERE activity_id = ? AND group_id = ?").bind(inv!.activity_id, g!.id),
      db
        .prepare("INSERT INTO members (activity_id, member_id, role, status, group_id, is_leader) VALUES (?, ?, 'student', 'active', ?, 1) ON CONFLICT(activity_id, member_id) DO UPDATE SET role = 'student', status = 'active', group_id = excluded.group_id, is_leader = 1")
        .bind(inv!.activity_id, c.sub, g!.id),
    ]);
    await notify(db, [c.sub], "你是組長了", `「${act?.title ?? ""}」${g!.name}：到「分組」頁按「分享連結」邀請組員，組員申請後也由你核准。`, `/groups/${inv!.activity_id}`);
    return { activityId: inv!.activity_id, role: "leader" };
  }
  await db
    .prepare("INSERT INTO members (activity_id, member_id, role, status) VALUES (?, ?, ?, 'active') ON CONFLICT(activity_id, member_id) DO UPDATE SET role = excluded.role, status = 'active', group_id = NULL, is_leader = 0")
    .bind(inv!.activity_id, c.sub, inv!.role)
    .run();
  return { activityId: inv!.activity_id, role: inv!.role };
});
