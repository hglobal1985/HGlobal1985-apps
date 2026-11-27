/**
 * 站內通知 → 手機推播的共用流程（伺服器共用模組；行動大學、寰宇繳作業系統與之後的 App 共用；杜杜龍 2026-11-27）。
 * 每款 App 只提供「怎麼讀資料」的小函式（哪些通知還沒推、怎麼標記、收件人有哪些裝置、裝置失效怎麼處理），
 * 推播的順序與規則統一在這裡：先標記再推（寧可漏推也不重複推）、裝置失效就刪、失敗就累計次數、最後清掉失敗太多次的裝置。
 */
import type { PushMessage, PushSub } from "./web-push.ts";

export type NoticeRow = { id: string; title: string; body: string; link: string };

export type NoticePushPlan<N extends NoticeRow> = {
  /** 還沒推播的通知（例如最近 30 分鐘、最多 30～50 則）。 */
  pending: () => Promise<N[]>;
  /** 標記為已推播；回傳 false 代表別人已經處理過（就跳過）。 */
  claim: (n: N) => Promise<boolean>;
  /** 這則通知的收件人有哪些推播裝置。 */
  devices: (n: N) => Promise<PushSub[]>;
  /** 推一則到一支裝置。 */
  send: (d: PushSub, msg: PushMessage) => Promise<"ok" | "gone" | "error">;
  /** 裝置已失效（瀏覽器取消訂閱）：刪掉。 */
  onGone: (d: PushSub) => Promise<unknown>;
  /** 推送失敗：累計失敗次數。 */
  onError: (d: PushSub) => Promise<unknown>;
  /** 全部推完後的清理（例如刪掉失敗 20 次以上的裝置）。 */
  cleanup?: () => Promise<unknown>;
  /** 通知沒有連結時點下去開哪裡。 */
  defaultLink?: string;
};

/** 依計畫把通知推出去，回傳成功推到的裝置次數。 */
export async function flushNoticePushes<N extends NoticeRow>(plan: NoticePushPlan<N>): Promise<number> {
  let sent = 0;
  for (const n of await plan.pending()) {
    if (!(await plan.claim(n))) continue;
    for (const d of await plan.devices(n)) {
      const r = await plan.send(d, { title: String(n.title), body: String(n.body), link: String(n.link || plan.defaultLink || "/notices") });
      if (r === "ok") sent++;
      else if (r === "gone") await plan.onGone(d);
      else await plan.onError(d);
    }
  }
  await plan.cleanup?.();
  return sent;
}
