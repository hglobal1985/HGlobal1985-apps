import type { AttachmentType } from "./contract.ts";
import { classifyUrl, LINK_TYPES } from "./link-rules.ts";

/** 依網址判斷附件類型（規則在 link-rules.ts，後端與 App 共用）。 */
export function classifyLink(u: URL): AttachmentType {
  return classifyUrl(u);
}

/** 只收 https 網址；回傳整理過的網址，不合格回 null。 */
export function parseHttpsUrl(input: unknown): URL | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s || s.length > 500) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    if (u.protocol !== "https:" || !u.hostname.includes(".") || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

/** 預設教材名稱（抓不到網頁標題時用）。 */
export const LINK_DEFAULT_TITLE = Object.fromEntries(Object.entries(LINK_TYPES).map(([k, v]) => [k, v.defaultTitle])) as Record<AttachmentType, string>;
