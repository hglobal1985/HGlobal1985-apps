/**
 * 內部橋接（接收端）：寰宇繳作業系統的通知頁可以顯示行動大學「指定類別」的通知（杜杜龍 2026-11-28，APP_BRIDGE_SECRET 雙向共用）。
 * 不走一般登入：用 Bearer APP_BRIDGE_SECRET 驗證呼叫端是繳作業伺服器；body { member_id, categories?, action: list | read | read_all, id? }。
 * 只回該會員**自己的**通知（recipient_sub），不含角色通知（管理員／會長的角色通知要用本人登入才看得到）；categories 只收已知的類別，
 * 預設只有「留言」。沒設密鑰或密鑰不對一律 401。行動大學不把資料複製給繳作業：繳作業每次即時讀、已讀寫回這裡。
 */
import { bridgeAuthorized } from "../../../packages/server-shared/src/app-bridge.ts";
import { fail, noticeCategory } from "./api-core.ts";
import type { Ctx } from "./api-core.ts";
import type { NoticeCategory } from "./contract.ts";

export const BRIDGE_CATEGORIES: readonly NoticeCategory[] = ["comment", "review", "subscribe", "achievement"];

export function pickCategories(v: unknown): NoticeCategory[] {
  const want = Array.isArray(v) ? v.filter((x): x is NoticeCategory => (BRIDGE_CATEGORIES as readonly unknown[]).includes(x)) : [];
  return want.length ? [...new Set(want)] : ["comment"];
}

export async function bridgeNotices(ctx: Ctx): Promise<unknown> {
  const env = ctx.env;
  if (!bridgeAuthorized(env.APP_BRIDGE_SECRET, ctx.req.headers.get("authorization"))) return fail(401, "unauthorized", "未授權");
  let b: { member_id?: unknown; categories?: unknown; action?: unknown; id?: unknown } = {};
  try {
    b = (await ctx.req.json()) as typeof b;
  } catch {
    /* 格式不對會在下面被擋 */
  }
  const member = typeof b.member_id === "string" ? b.member_id : "";
  if (!member) return fail(400, "bad_request", "缺少會員");
  const cats = pickCategories(b.categories);
  const rows = (
    await env.DB.prepare("SELECT id, title, body, link, read_at, created_at FROM notifications WHERE recipient_sub = ? ORDER BY created_at DESC LIMIT 300").bind(member).all<{ id: string; title: string; body: string; link: string; read_at: string | null; created_at: string }>()
  ).results.filter((r) => (cats as string[]).includes(noticeCategory(r.title, r.link)));
  if (b.action === "read" && typeof b.id === "string") {
    if (rows.some((r) => r.id === b.id)) await env.DB.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND recipient_sub = ?").bind(new Date().toISOString(), b.id, member).run();
    return { ok: true };
  }
  if (b.action === "read_all") {
    const ids = rows.filter((r) => !r.read_at).map((r) => r.id);
    if (ids.length) await env.DB.batch(ids.map((id) => env.DB.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND recipient_sub = ?").bind(new Date().toISOString(), id, member)));
    return { ok: true };
  }
  return { notices: rows.slice(0, 100).map((r) => ({ id: r.id, title: r.title, body: r.body, link: r.link, read: !!r.read_at, createdAt: r.created_at })), categories: cats };
}
