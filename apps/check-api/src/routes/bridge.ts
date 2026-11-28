/**
 * 內部橋接：行動大學通知頁的「繳作業」分頁向這裡讀這位會員的通知（杜杜龍 2026-11-28；packages/server-shared/src/app-bridge.ts）。
 * 不走一般登入：用 APP_BRIDGE_SECRET（Bearer）驗證呼叫端是行動大學伺服器；body { member_id, action: list | read | read_all, id? }。
 * member_id 由行動大學用它自己驗證過的登入會員帶入；沒設密鑰或密鑰不對一律 401。
 */
import { bridgeAuthorized, bridgePost } from "../../../../packages/server-shared/src/app-bridge.ts";
import type { LearnNotices, Notice } from "../contract.ts";
import { type Row, body, json, now, on } from "../core.ts";
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

// ───────────── 反向：通知頁的「行動大學」分頁（杜杜龍 2026-11-28）─────────────
// 即時向行動大學讀這位會員「指定類別」的通知（預設只有留言），繳作業不存副本；已讀寫回行動大學。會員編號用繳作業已驗證的登入（c.sub）。
export const LEARN_ORIGIN = "https://learn.hglobal1985.com";
const LEARN_CATEGORIES = ["comment", "review", "subscribe", "achievement"];
const pick = (v: unknown): string[] => {
  const list = (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).filter((x): x is string => typeof x === "string" && LEARN_CATEGORIES.includes(x));
  return list.length ? [...new Set(list)] : ["comment"];
};
type Remote = { notices?: Notice[] };

on("GET", "/notices/learn", async (c, _p, req) => {
  const categories = pick(new URL(req.url).searchParams.get("categories"));
  const r = await bridgePost<Remote>(c.env.APP_BRIDGE_SECRET, `${LEARN_ORIGIN}/api/v2/internal/notices`, { member_id: c.sub, categories, action: "list" });
  const empty: LearnNotices = { available: false, origin: LEARN_ORIGIN, categories, notices: [] };
  if (!r || !Array.isArray(r.notices)) return empty;
  return { available: true, origin: LEARN_ORIGIN, categories, notices: r.notices.slice(0, 100).map((n): Notice => ({ id: String(n.id), title: String(n.title).slice(0, 80), body: String(n.body).slice(0, 300), link: String(n.link).startsWith("/") ? String(n.link) : "/", read: !!n.read, createdAt: String(n.createdAt) })) } satisfies LearnNotices;
});
on("POST", "/notices/learn/read", async (c, _p, req) => {
  const b = await body(req);
  const categories = pick(b.categories);
  const r = await bridgePost<{ ok?: boolean }>(c.env.APP_BRIDGE_SECRET, `${LEARN_ORIGIN}/api/v2/internal/notices`, typeof b.id === "string" ? { member_id: c.sub, categories, action: "read", id: b.id } : { member_id: c.sub, categories, action: "read_all" });
  return { ok: !!r?.ok };
});
