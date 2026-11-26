import { Platform } from "react-native";

/**
 * 前台錯誤回報（杜杜龍 2026-11-21 同意）：使用者手機上畫面出錯時，自動把「錯誤訊息＋發生在哪一頁」送回伺服器，
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

/**
 * 舊版網頁的頁面檔案已被新版取代（杜杜龍 2026-11-22 回報：久沒用再點通知，整頁空白約 10 秒才出現）：
 * 網站每次更新，檔名帶雜湊的頁面程式檔（`/_expo/static/js/…`）會換掉，很久沒重新整理的舊網頁再切到沒載入過的頁面，
 * 會因為檔案已不存在而載入失敗、畫面空白。偵測到這種失敗就自動重新載入最新版（2 分鐘內最多一次，避免無限重新載入）。
 */
const CHUNK_FAIL = /Failed to (load|fetch)|Loading (module|chunk|CSS chunk)|ChunkLoadError|Importing a module script failed|error loading dynamically imported|_expo\/static\/js/i;
function recoverFromStaleChunks(): void {
  try {
    const key = "hglobal:learn:chunk-reload";
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 120_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    /* 沒有 sessionStorage 也照樣重新載入一次 */
  }
  window.location.reload();
}

/** 網頁版：接住所有沒被處理的錯誤（在根版面最早呼叫一次）。 */
export function installErrorReporting(): void {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  // 頁面程式檔（script）載入失敗：資源錯誤不會冒泡，要在 capture 階段接。
  window.addEventListener(
    "error",
    (e) => {
      const t = e.target as HTMLElement | null;
      if (t && t.tagName === "SCRIPT" && /\/_expo\/static\/js\//.test((t as HTMLScriptElement).src ?? "")) recoverFromStaleChunks();
    },
    true,
  );
  window.addEventListener("error", (e) => {
    // 圖片、字型載入失敗也會觸發 error 事件（沒有 error 物件），不是程式錯誤，略過。
    if (!(e as ErrorEvent).error && !(e as ErrorEvent).message) return;
    reportClientError("error", (e as ErrorEvent).error ?? (e as ErrorEvent).message);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = (e as PromiseRejectionEvent).reason;
    if (CHUNK_FAIL.test(r instanceof Error ? `${r.name}: ${r.message}` : String(r))) {
      reportClientError("chunk-load", r);
      recoverFromStaleChunks();
      return;
    }
    // 一般的 API 錯誤（沒有權限、網路斷線…）畫面已經有提示，不算程式錯誤。
    if (r && typeof r === "object" && "status" in r) return;
    reportClientError("promise", r);
  });
}
