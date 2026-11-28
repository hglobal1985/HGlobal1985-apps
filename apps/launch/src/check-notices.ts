/**
 * 通知頁「繳作業」分頁（杜杜龍 2026-11-28，做法 A）：即時向寰宇繳作業系統讀這位會員的通知，行動大學不存副本、已讀只有一份（在繳作業那邊）。
 * 走內部橋接（packages/server-shared/src/app-bridge.ts，Secret APP_BRIDGE_SECRET）；會員編號一律來自行動大學已驗證的登入，不收前端傳的。
 * 沒設密鑰、對方不可用或逾時：available=false，畫面顯示「暫時讀不到」，不影響其他通知。
 */
import { bridgePost } from "../../../packages/server-shared/src/app-bridge.ts";
import type { CheckNotices } from "./contract.ts";
import type { Env } from "./d1.ts";

export const CHECK_ORIGIN = "https://check.hglobal1985.com";
type Remote = { notices?: { id: string; title: string; body: string; link: string; read: boolean; createdAt: string }[] };

export async function loadCheckNotices(env: Env, memberId: string): Promise<CheckNotices> {
  const r = await bridgePost<Remote>(env.APP_BRIDGE_SECRET, `${CHECK_ORIGIN}/api/internal/notices`, { member_id: memberId, action: "list" });
  if (!r || !Array.isArray(r.notices)) return { available: false, notices: [], origin: CHECK_ORIGIN };
  return { available: true, origin: CHECK_ORIGIN, notices: r.notices.slice(0, 100).map((n) => ({ id: String(n.id), title: String(n.title).slice(0, 80), body: String(n.body).slice(0, 300), link: String(n.link).startsWith("/") ? String(n.link) : "/", read: !!n.read, createdAt: String(n.createdAt) })) };
}

/** 標為已讀（id 省略＝全部）。回 false＝沒成功。 */
export async function readCheckNotices(env: Env, memberId: string, id?: string): Promise<boolean> {
  const r = await bridgePost<{ ok?: boolean }>(env.APP_BRIDGE_SECRET, `${CHECK_ORIGIN}/api/internal/notices`, id ? { member_id: memberId, action: "read", id } : { member_id: memberId, action: "read_all" });
  return !!r?.ok;
}
