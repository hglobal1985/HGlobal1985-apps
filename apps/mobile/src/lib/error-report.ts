import { Platform } from "react-native";

/**
 * 前台錯誤回報（業主 2026-11-21 同意）：使用者手機上畫面出錯時，自動把「錯誤訊息＋發生在哪一頁」送回伺服器，
 * 寫進 Cloudflare 的錯誤紀錄（不存資料庫、不含會員身分），每週的自動檢查會一起看。
 * 同一次開網站最多回報 5 則、同樣的錯誤只報一次；回報失敗就算了，不影響使用。
 */
const sent = new Set<string>();
let count = 0;
export function reportClientError(kind: string, error: unknown, extra = ""): void {
  try {
    if (count >= 5) return;
    const e = error instanceof Error ? error : null;
    const message = (e ? `${e.name}: ${e.message}` : String(error)).slice(0, 300);
    const key = `${kind}|${message}`;
    if (sent.has(key)) return;
    sent.add(key);
    count++;
    const body = JSON.stringify({
      kind,
      message,
      stack: (e?.stack ?? "").slice(0, 1500),
      extra: extra.slice(0, 300),
      page: typeof location !== "undefined" ? location.pathname + location.search : "",
      platform: Platform.OS,
      ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : "",
    });
    const url = `${Platform.OS === "web" ? "" : "https://learn.hglobal1985.com"}/api/v2/client-errors`;
    void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch {
    /* 回報本身出錯就放棄 */
  }
}

/** 網頁版：接住所有沒被處理的錯誤（在根版面最早呼叫一次）。 */
export function installErrorReporting(): void {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  window.addEventListener("error", (e) => {
    // 圖片、字型載入失敗也會觸發 error 事件（沒有 error 物件），不是程式錯誤，略過。
    if (!(e as ErrorEvent).error && !(e as ErrorEvent).message) return;
    reportClientError("error", (e as ErrorEvent).error ?? (e as ErrorEvent).message);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = (e as PromiseRejectionEvent).reason;
    // 一般的 API 錯誤（沒有權限、網路斷線…）畫面已經有提示，不算程式錯誤。
    if (r && typeof r === "object" && "status" in r) return;
    reportClientError("promise", r);
  });
}
