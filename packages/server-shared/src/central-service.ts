/**
 * 中央會員「服務金鑰」的伺服器共用程式（行動大學與寰宇繳作業系統共用同一份；杜杜龍 2026-11-27）。
 * - 服務 Token：POST /v1/service/token {"app_id","client_secret"}（10 分鐘，快取在記憶體）。
 * - 聯絡查詢：POST /v1/apps/<app_id>/contacts/lookup，寄信當下才查、用完即丟（不寫入資料庫或日誌；中央串接指令 三、11）。
 * 服務金鑰只放在 Worker 的 Secret（CENTRAL_SERVICE_SECRET），絕不放在手機或網頁。
 */
import type { Fetch } from "./central-verify.ts";

export type ContactPurpose = "payment_notice" | "course_notice" | "account_security";

const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,255}\.[^\s@<>"',;]{2,63}$/;
export const validEmail = (s: string) => s.length <= 254 && EMAIL_RE.test(s);

export function createServiceClient(central: string, appId: string, getFetch: () => Fetch) {
  let cached: { token: string; until: number } | null = null;

  /** 取得服務 Token（拿不到回 null）。 */
  async function token(secret: string): Promise<string | null> {
    if (cached && cached.until > Date.now() + 30_000) return cached.token;
    try {
      const res = await getFetch()(`${central}/v1/service/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app_id: appId, client_secret: secret }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const b = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
      if (typeof b.access_token !== "string") return null;
      cached = { token: b.access_token, until: Date.now() + (typeof b.expires_in === "number" ? b.expires_in : 300) * 1000 };
      return cached.token;
    } catch {
      return null;
    }
  }

  /** 中央回 401 時呼叫：丟掉快取的 Token，下次重拿。 */
  const forget = () => {
    cached = null;
  };

  /**
   * 寄信時才向中央查聯絡信箱。查不到的會員不在結果裡；中央無法連線或金鑰無效時回傳空表（寧可不寄，也不用舊副本）。
   */
  async function lookupContactEmails(secret: string | undefined, subs: string[], purpose: ContactPurpose): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const ids = [...new Set(subs)];
    if (!secret || !ids.length) return out;
    const t = await token(secret);
    if (!t) return out;
    for (let i = 0; i < ids.length; i += 50) {
      try {
        const res = await getFetch()(`${central}/v1/apps/${appId}/contacts/lookup`, {
          method: "POST",
          headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
          body: JSON.stringify({ member_ids: ids.slice(i, i + 50), purpose }),
          signal: AbortSignal.timeout(5000),
        });
        if (res.status === 401) forget();
        if (!res.ok) continue;
        const b = (await res.json()) as { contacts?: { member_id?: unknown; email?: unknown }[] };
        for (const c of b.contacts ?? []) if (typeof c.member_id === "string" && typeof c.email === "string" && validEmail(c.email)) out.set(c.member_id, c.email);
      } catch {
        /* 查不到就不寄 */
      }
    }
    return out;
  }

  return { token, forget, lookupContactEmails };
}
