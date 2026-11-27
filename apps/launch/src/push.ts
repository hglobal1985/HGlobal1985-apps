import type { D1Database, Env } from "./d1.ts";

/**
 * 手機推播通知（Web Push，杜杜龍 2026-11-17）：
 * - 站內通知（notifications 表）新增後，背景把「還沒推播」的通知推到收件人已開啟推播的每個裝置。
 * - 金鑰：VAPID 私鑰（JWK）放在 Cloudflare Secret `VAPID_PRIVATE_JWK`；公鑰由私鑰算出，給瀏覽器訂閱用。沒設定就整個不推播（站內通知照常）。
 * - 內容依 RFC 8291（aes128gcm）加密；只用 Web Crypto，不靠外部套件。
 */

import { encryptPayload, sendPush as sendWith, vapidJwk as parseJwk, vapidPublicKey as publicOf, type PushMessage, type PushSub } from "../../../packages/server-shared/src/web-push.ts";
export { encryptPayload, type PushMessage };
type Sub = PushSub;
/** 加密與傳送的程式在 packages/server-shared/src/web-push.ts（與繳作業系統共用）；這裡只接上行動大學的金鑰與網址。 */
const SUBJECT = "https://learn.hglobal1985.com";
const vapidJwk = (env: Env) => parseJwk(env.VAPID_PRIVATE_JWK);
/** 給瀏覽器訂閱用的公鑰（65 bytes 未壓縮點，base64url）；沒設定金鑰回 null。 */
export function vapidPublicKey(env: Env): string | null {
  return publicOf(env.VAPID_PRIVATE_JWK);
}
/** 推一則給一個裝置；回傳 "ok"、"gone"（訂閱已失效，要刪除）或 "error"。fetcher 可替換（測試用）。 */
export async function sendPush(env: Env, sub: Sub, msg: PushMessage, fetcher: typeof fetch = fetch): Promise<"ok" | "gone" | "error"> {
  return sendWith(env.VAPID_PRIVATE_JWK, SUBJECT, sub, msg, fetcher);
}

type Pending = { id: string; recipient_sub: string | null; recipient_role: string | null; recipient_center_key: string | null; title: string; body: string; link: string };

/** 收件人有哪些推播裝置（個人、總部管理員、某中心會長）。 */
async function devicesOf(db: D1Database, n: Pending): Promise<Sub[]> {
  const q = n.recipient_sub
    ? db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE member_sub = ?").bind(n.recipient_sub)
    : n.recipient_role === "admin"
      ? db.prepare("SELECT p.endpoint, p.p256dh, p.auth FROM push_subscriptions p JOIN member_contacts m ON m.member_sub = p.member_sub WHERE m.is_admin = 1")
      : n.recipient_role === "president" && n.recipient_center_key
        ? db.prepare("SELECT p.endpoint, p.p256dh, p.auth FROM push_subscriptions p JOIN member_contacts m ON m.member_sub = p.member_sub WHERE m.president_center_key = ?").bind(n.recipient_center_key)
        : null;
  return q ? (await q.all<Sub>()).results : [];
}

/** 把最近 30 分鐘內還沒推播的站內通知推出去（先標記再推：寧可漏推也不重複推）。回傳推出去的則數。 */
export async function flushPushes(env: Env, fetcher: typeof fetch = fetch): Promise<number> {
  if (!vapidJwk(env)) return 0;
  const db = env.DB;
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  const { results } = await db
    .prepare("SELECT id, recipient_sub, recipient_role, recipient_center_key, title, body, link FROM notifications WHERE pushed = 0 AND created_at >= ? ORDER BY created_at LIMIT 30")
    .bind(since)
    .all<Pending>();
  let sent = 0;
  for (const n of results) {
    const claim = await db.prepare("UPDATE notifications SET pushed = 1 WHERE id = ? AND pushed = 0").bind(n.id).run();
    if (claim.meta?.changes === 0) continue;
    for (const d of await devicesOf(db, n)) {
      const r = await sendPush(env, d, { title: n.title, body: n.body, link: n.link || "/notices" }, fetcher);
      if (r === "ok") sent++;
      else if (r === "gone") await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(d.endpoint).run();
      else await db.prepare("UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?").bind(d.endpoint).run();
    }
  }
  // 連續失敗太多次的裝置不再嘗試。
  await db.prepare("DELETE FROM push_subscriptions WHERE failures >= 20").run();
  return sent;
}

/**
 * 開課前一天提醒（杜杜龍 2026-11-17）：台灣時間每天 20:00 之後第一次執行時，替「明天開課」的已上架課程（清單卡除外），
 * 通知每位已報名（已開通）的學員。同一門課同一天只發一次（course_reminders）。回傳發出幾則。
 */
export async function courseReminders(env: Env, now = Date.now()): Promise<number> {
  const tw = new Date(now + 8 * 3600 * 1000);
  if (tw.getUTCHours() < 20) return 0;
  const today = tw.toISOString().slice(0, 10);
  const tomorrow = new Date(now + 32 * 3600 * 1000).toISOString().slice(0, 10);
  const db = env.DB;
  const { results } = await db
    .prepare("SELECT id, title FROM courses WHERE status = 'published' AND is_list = 0 AND substr(event_start, 1, 10) = ? AND NOT EXISTS (SELECT 1 FROM course_reminders r WHERE r.course_id = courses.id AND r.day = ?)")
    .bind(tomorrow, today)
    .all<{ id: string; title: string }>();
  let n = 0;
  for (const c of results) {
    const claim = await db.prepare("INSERT OR IGNORE INTO course_reminders (course_id, day) VALUES (?, ?)").bind(c.id, today).run();
    if (claim.meta?.changes === 0) continue;
    const { results: subs } = await db.prepare("SELECT member_sub FROM enrollments WHERE course_id = ?").bind(c.id).all<{ member_sub: string }>();
    for (const s of subs) {
      await db
        .prepare("INSERT INTO notifications (id, recipient_sub, title, body, link) VALUES (?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), s.member_sub, "明天開課提醒", `「${c.title}」明天開課，別忘了準時參加！`, `/course/${c.id}`)
        .run();
      n++;
    }
  }
  return n;
}
