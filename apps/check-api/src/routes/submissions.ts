/** 寰宇繳作業系統 API 網址：學員繳交、下載憑證、批改、留言與檢舉（杜杜龍 2026-11-27 從 api.ts 拆出；這個檔被載入時就把網址登記進路由表）。 */
import { KINDS, LIMITS, type Kind } from "../contract.ts";
import type { D1Database } from "../env.ts";
import { type Row, access, body, canSeeSubmission, countEntries, deadlinePassed, deleteR2, editableSubmission, fail, grade, itemCard, itemView, lateOk, loadItem, membership, needActive, needManager, needTeacher, notify, now, num, on, queue, returnSubmission, rid, sniff, str, submissionView } from "../core.ts";

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
export async function mySubmissionFor(db: D1Database, item: Row, memberId: string): Promise<Row> {
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
