/** 寰宇繳作業系統 API 網址：我的、首頁、推播、上傳設定（杜杜龍 2026-11-27 從 api.ts 拆出；這個檔被載入時就把網址登記進路由表）。 */
import type { Me } from "../contract.ts";
import { DEFAULT_SHARED_UPLOAD, readSharedUpload, writeSharedUpload } from "../../../../packages/server-shared/src/upload-settings.ts";
import { sendPush, vapidPublicKey } from "../../../../packages/server-shared/src/web-push.ts";
import { PUSH_SUBJECT, type Row, access, activityView, body, bool, fail, home, needManager, notify, now, on, rid, str, superAdmin } from "../core.ts";

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
// 測試推播：只推給自己這個帳號開過推播的每支裝置，回報送到幾支（杜杜龍 2026-11-27：讓杜杜龍自己就能排查收不到的原因）
on("POST", "/push/test", async (c) => {
  if (!vapidPublicKey(c.env.VAPID_PRIVATE_JWK)) fail(503, "推播功能還在設定中");
  const subs = (await c.env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subs WHERE member_id = ?").bind(c.sub).all<{ endpoint: string; p256dh: string; auth: string }>()).results;
  let ok = 0;
  for (const d of subs) {
    const r = await sendPush(c.env.VAPID_PRIVATE_JWK, PUSH_SUBJECT, d, { title: "測試通知", body: "看到這則就代表推播正常 👍", link: "/me" });
    if (r === "ok") ok++;
    else if (r === "gone") await c.env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(d.endpoint).run();
  }
  return { devices: subs.length, ok };
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
