/**
 * 錯誤回報統計 → 中央（生態系統功能 3 錯誤回報週報；串接指令 2026-11-27.4 三、18 (3)；伺服器共用模組，杜杜龍 2026-11-27）。
 * 前台錯誤本來就會送到 App 自己的 /client-errors；這裡把它「只留種類、頁面路徑、次數」累加在記憶體，
 * 每 30 秒左右（有新錯誤進來時才檢查）批次 POST 到中央 /v1/apps/<app_id>/error-reports（不帶 Token）。
 * 絕對不送：錯誤訊息、堆疊、網址參數、Token、姓名、信箱、Amway 欄位。送失敗或被限流就丟掉（統計不是重要資料）。
 * 中央沒有讓這款 App 參與（config.eco_features.error_digest.enabled 為 false）時，中央會回 accepted 0、不存任何東西。
 */
export type DigestKind = "crash" | "render" | "network" | "api" | "auth" | "other";

/** 各 App 前台回報的種類 → 中央規定的六種。 */
export function digestKind(clientKind: string): DigestKind {
  switch (clientKind) {
    case "error":
      return "crash";
    case "render":
    case "lazy-part":
      return "render";
    case "chunk-load":
    case "network":
      return "network";
    case "api":
      return "api";
    case "auth":
      return "auth";
    default:
      return "other";
  }
}

/** 只留路徑（去掉網址參數與 # 片段），不合規就退回 /，長度上限 120。 */
export function digestPage(raw: string): string {
  const path = raw.split(/[?#]/)[0] ?? "";
  if (!path.startsWith("/") || path.length > 120 || !/^\/[A-Za-z0-9_\-./:]*$/.test(path)) return "/";
  return path;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export type ErrorDigest = {
  /** 記一筆（同種類＋頁面累加）；到了送出時間就背景批次送出。 */
  record: (clientKind: string, page: string, background?: (p: Promise<unknown>) => void) => void;
  /** 立刻送出目前累加的（測試與排程用）；回傳送出的筆數。 */
  flush: () => Promise<number>;
};

export function createErrorDigest(opts: {
  central: string;
  appId: string;
  /** 像 1.4.0 的版本號（中央規定格式）。 */
  version: string;
  getFetch?: () => Fetch;
  intervalMs?: number;
  now?: () => number;
}): ErrorDigest {
  const pending = new Map<string, { kind: DigestKind; page: string; count: number }>();
  const interval = opts.intervalMs ?? 30_000;
  const now = opts.now ?? Date.now;
  let lastFlush = now();
  let backoffUntil = 0;

  async function flush(): Promise<number> {
    lastFlush = now();
    if (!pending.size || now() < backoffUntil) return 0;
    const batch = [...pending.values()].slice(0, 20);
    for (const b of batch) pending.delete(`${b.kind}|${b.page}`);
    try {
      const f = opts.getFetch?.() ?? ((u: string, i?: RequestInit) => fetch(u, i));
      const res = await f(`${opts.central}/v1/apps/${opts.appId}/error-reports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reports: batch.map((b) => ({ kind: b.kind, page: b.page, app_version: opts.version, count: Math.min(b.count, 1000) })) }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 429) backoffUntil = now() + Math.min(Math.max(Number(res.headers.get("retry-after")) || 60, 1), 600) * 1000;
      return res.ok ? batch.length : 0;
    } catch {
      return 0; // 失敗就丟掉這批
    }
  }

  return {
    flush,
    record(clientKind, page, background) {
      const kind = digestKind(clientKind);
      const p = digestPage(page);
      const key = `${kind}|${p}`;
      const cur = pending.get(key);
      if (cur) cur.count++;
      else if (pending.size < 200) pending.set(key, { kind, page: p, count: 1 });
      if (background && (now() - lastFlush >= interval || pending.size >= 20)) background(flush());
    },
  };
}
