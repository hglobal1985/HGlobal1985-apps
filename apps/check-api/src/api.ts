/**
 * 寰宇繳作業系統 API 進入點（杜杜龍 2026-11-27 拆檔，做法同行動大學）：共用函式在 core.ts，各功能的網址在 routes/*.ts，
 * 這裡依序載入各功能檔（載入順序＝網址比對順序，不要隨意調換），並處理請求、下載、webhook、排程。
 */
export * from "./core.ts";
export * from "./routes/account.ts";
export * from "./routes/activities.ts";
export * from "./routes/people.ts";
export * from "./routes/submissions.ts";
export * from "./routes/files.ts";
export * from "./routes/system.ts";
import "./routes/account.ts";
import "./routes/activities.ts";
import "./routes/people.ts";
import "./routes/submissions.ts";
import "./routes/files.ts";
import "./routes/system.ts";
import { verifyWebhook, forgetMember, INTEGRATED_VERSION } from "./central.ts";
import type { Env } from "./env.ts";
import { API_VERSION, type Ctx, HttpError, type Row, authenticate, deleteR2, flushEmails, flushPushes, json, notify, refreshPerson, retentionOf, routes, setPushSoon } from "./core.ts";
import { notSubmitted, purgeFiles, twTime } from "./routes/files.ts";
import { clientError } from "./routes/system.ts";

// ───────────── 進入點 ─────────────
export async function handleApi(req: Request, env: Env, bg: (p: Promise<unknown>) => void = () => {}): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  try {
    if (path === "/version") return json({ version: API_VERSION, integrated: INTEGRATED_VERSION, sha: env.GIT_SHA ?? null });
    if (path === "/central/webhook" && req.method === "POST") return await webhook(req, env);
    if (path === "/client-errors" && req.method === "POST") return await clientError(req);
    const auth = await authenticate(req, env);
    if (!auth) return json({ error: { code: "unauthenticated", message: "請先登入" } }, 401);
    const c: Ctx = { env, sub: auth.sub, token: auth.token, bg };
    let queued = false;
    setPushSoon(() => {
      if (queued) return;
      queued = true;
      bg(flushPushes(env));
      bg(flushEmails(env).catch(() => 0));
    });
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
export const lastRefresh = new Map<string, number>();
export async function refreshPersonThrottled(c: Ctx): Promise<void> {
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
export async function webhook(req: Request, env: Env): Promise<Response> {
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
  setPushSoon(null);
  await db.prepare("DELETE FROM tickets WHERE expires_at < ?").bind(Date.now()).run();
  await db.prepare("DELETE FROM zip_tickets WHERE expires_at < ?").bind(Date.now()).run();
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
  // 備份提醒（杜杜龍 2026-11-27）：活動結束隔天通知一次「請下載備份」，刪除前 30／7／1 天再提醒；
  // 站內通知＋手機推播＋Email，通知管理員、老師與全體組員，連結直接開「一鍵下載備份」頁（老師以上是全部檔案，其他人是自己的）。
  const acts = (await db.prepare("SELECT * FROM activities WHERE files_purged_at IS NULL AND (retention_until IS NOT NULL OR ends_on IS NOT NULL)").all<Row>()).results;
  for (const a of acts) {
    const until = retentionOf(a);
    if (!until) continue;
    if (until <= today) {
      await purgeFiles(env, String(a.id));
      continue;
    }
    const days = Math.round((Date.parse(until) - Date.parse(today)) / 86400_000);
    const ended = typeof a.ends_on === "string" && a.ends_on < today;
    const key = [30, 7, 1].includes(days) ? `purge-d${days}` : ended ? "ended" : "";
    if (!key) continue;
    const ms = (await db.prepare("SELECT member_id, role FROM members WHERE activity_id = ? AND status = 'active'").bind(a.id).all<Row>()).results;
    const sent = new Set((await db.prepare("SELECT member_id FROM reminders_sent WHERE lesson_id = ? AND kind = ?").bind(a.id, key).all<Row>()).results.map((r) => String(r.member_id)));
    const todo = ms.filter((m) => !sent.has(String(m.member_id)));
    if (!todo.length) continue;
    const untilTw = until.replace(/-/g, "/");
    const title = key === "ended" ? `「${a.title}」已結束，請下載作業備份` : `作業檔案 ${days} 天後刪除，請下載備份`;
    const text = (staff: boolean) =>
      `「${a.title}」的作業檔案（照片、影片、文件）將在 ${untilTw} 自動刪除，成績與評語會保留。請在那之前按「一鍵下載備份」存到手機或電腦${staff ? "（你會下載到全部學員的檔案）" : ""}。`;
    const staffIds = todo.filter((m) => m.role !== "student").map((m) => String(m.member_id));
    const studentIds = todo.filter((m) => m.role === "student").map((m) => String(m.member_id));
    await notify(db, staffIds, title, text(true), `/files/${a.id}?all=1`, { email: true });
    await notify(db, studentIds, title, text(false), `/files/${a.id}`, { email: true });
    await db.batch(todo.map((m) => db.prepare("INSERT INTO reminders_sent (lesson_id, member_id, kind) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(a.id, m.member_id, key)));
  }
  await flushPushes(env).catch((e) => console.error("push flush", e instanceof Error ? e.message : "error"));
  await flushEmails(env).catch((e) => console.error("email flush", e instanceof Error ? e.message : "error"));
}
