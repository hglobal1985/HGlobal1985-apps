/**
 * 內部橋接：行動大學通知頁的「繳作業」分頁向這裡讀這位會員的通知（杜杜龍 2026-11-28；packages/server-shared/src/app-bridge.ts）。
 * 不走一般登入：用 APP_BRIDGE_SECRET（Bearer）驗證呼叫端是行動大學伺服器；body { member_id, action: list | read | read_all, id? }。
 * member_id 由行動大學用它自己驗證過的登入會員帶入；沒設密鑰或密鑰不對一律 401。
 */
import { bridgeAuthorized } from "../../../../packages/server-shared/src/app-bridge.ts";
import type { Notice } from "../contract.ts";
import { type Row, json, now } from "../core.ts";
import type { Env } from "../env.ts";

export async function bridgeNotices(req: Request, env: Env): Promise<Response> {
  if (!bridgeAuthorized(env.APP_BRIDGE_SECRET, req.headers.get("authorization"))) return json({ error: { code: "unauthorized", message: "未授權" } }, 401);
  let b: { member_id?: unknown; action?: unknown; id?: unknown } = {};
  try {
    b = (await req.json()) as typeof b;
  } catch {
    /* 格式不對會在下面被擋 */
  }
  const member = typeof b.member_id === "string" ? b.member_id : "";
  if (!member) return json({ error: { code: "bad_request", message: "缺少會員" } }, 400);
  const db = env.DB;
  if (b.action === "read" && typeof b.id === "string") {
    await db.prepare("UPDATE notices SET read_at = COALESCE(read_at, ?) WHERE id = ? AND member_id = ?").bind(now(), b.id, member).run();
    return json({ ok: true });
  }
  if (b.action === "read_all") {
    await db.prepare("UPDATE notices SET read_at = ? WHERE member_id = ? AND read_at IS NULL").bind(now(), member).run();
    return json({ ok: true });
  }
  const rows = (await db.prepare("SELECT id, title, body, link, read_at, created_at FROM notices WHERE member_id = ? ORDER BY created_at DESC LIMIT 100").bind(member).all<Row>()).results;
  return json({ notices: rows.map((r): Notice => ({ id: String(r.id), title: String(r.title), body: String(r.body), link: String(r.link), read: !!r.read_at, createdAt: String(r.created_at) })) });
}
