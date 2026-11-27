/** 寰宇繳作業系統 API 網址：前台錯誤回報（杜杜龍 2026-11-27 從 api.ts 拆出；這個檔被載入時就把網址登記進路由表）。 */
import { errorDigest } from "../central.ts";
import { json } from "../core.ts";

// 前台錯誤回報（共用元件 lib/error-report.ts；與行動大學同一套做法）：只寫進 Cloudflare 的錯誤紀錄，不存資料庫、不含會員身分；同一來源每分鐘最多 10 則。
export const clientErrorHits = new Map<string, { at: number; n: number }>();
export async function clientError(req: Request, bg?: (p: Promise<unknown>) => void): Promise<Response> {
  const ip = req.headers.get("cf-connecting-ip") ?? "";
  const t = Date.now();
  const hit = clientErrorHits.get(ip);
  if (hit && t - hit.at < 60_000 && hit.n >= 10) return json({ ok: true });
  clientErrorHits.set(ip, hit && t - hit.at < 60_000 ? { at: hit.at, n: hit.n + 1 } : { at: t, n: 1 });
  if (clientErrorHits.size > 500) clientErrorHits.delete(clientErrorHits.keys().next().value!);
  let b: Record<string, unknown> = {};
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    /* 格式不對就記空的 */
  }
  const s = (k: string, max: number) => (typeof b[k] === "string" ? (b[k] as string).slice(0, max) : "");
  console.error("client error", JSON.stringify({ kind: s("kind", 20), message: s("message", 300), page: s("page", 200), platform: s("platform", 10), ua: s("ua", 200), extra: s("extra", 300), stack: s("stack", 1500) }));
  errorDigest.record(s("kind", 20), s("page", 200), bg); // 只累加種類＋頁面路徑＋次數，批次送中央週報（生態系統功能 3）
  return json({ ok: true });
}
