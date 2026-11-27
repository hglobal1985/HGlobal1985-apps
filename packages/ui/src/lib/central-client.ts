/**
 * 中央會員登入的共用工具（App 端；行動大學、寰宇繳作業系統與之後的每一款寰宇 App 共用；杜杜龍 2026-11-27）。
 * 只放「每款 App 都一樣」的部分，各 App 的登入流程（回傳網址、畫面）仍在自己的 central 檔：
 * - CentralError：中央回傳的錯誤（status、code、給會員看的中文訊息）。
 * - createCentralRequest：呼叫中央 API（自動帶 JSON、Bearer，錯誤轉成中文）。
 * - createTokenVault：登入憑證的保存（登入永不過期，中央串接指令 2026-11-27.1）：手機放系統安全儲存，
 *   網頁放 localStorage（關分頁、關瀏覽器都還是登入），並提供跨分頁換發鎖與「別的分頁改了」的通知。
 * - isOutdated：App 版本比對（中央 config 的 min_version）。
 * - pkceHash／randomHex：登入中繼用的 nonce 雜湊與隨機字串。
 */
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const web = Platform.OS === "web";

export class CentralError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 預設的中文錯誤訊息（各 App 可以覆蓋）。 */
export const CENTRAL_FRIENDLY: Record<string, string> = {
  app_unavailable: "系統維護中，請稍後再試",
  account_disabled: "這個帳號已停用，請聯絡客服",
  rate_limited: "操作太頻繁，請稍後再試",
  network: "連不上會員中心，請檢查網路後再試",
};

/**
 * 建立「呼叫中央 API」的函式。base＝中央網址；messages＝錯誤代碼對應的中文（沒有對應就用中央的訊息或 fallback）。
 */
export function createCentralRequest(base: string, messages: Record<string, string> = CENTRAL_FRIENDLY, fallback = "登入失敗，請再試一次") {
  return async function central<T>(path: string, method = "GET", body?: unknown, token?: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(base + path, {
        method,
        headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new CentralError(0, "network", messages.network ?? CENTRAL_FRIENDLY.network!);
    }
    if (!res.ok) {
      const e = ((await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null)?.error;
      const code = e?.code ?? "central_error";
      throw new CentralError(res.status, code, messages[code] ?? e?.message ?? fallback);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  };
}

const ls = (): Storage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // 無痕模式或封鎖網站資料：只在這次開啟期間有效
  }
};

/**
 * 登入憑證保存處。lockName＝跨分頁換發鎖的名字（每款 App 不同，例如 "hglobal.check.refresh"）。
 * 鍵名由各 App 自己決定（改鍵名會讓已登入的人被登出，所以既有 App 沿用原本的鍵名）。
 */
export function createTokenVault(lockName: string) {
  const vault = {
    async get(key: string): Promise<string | null> {
      return web ? (ls()?.getItem(key) ?? null) : SecureStore.getItemAsync(key);
    },
    async set(key: string, value: string | null): Promise<void> {
      if (web) {
        if (value) ls()?.setItem(key, value);
        else ls()?.removeItem(key);
      } else if (value) await SecureStore.setItemAsync(key, value);
      else await SecureStore.deleteItemAsync(key);
    },
    /** 跨分頁加鎖：同一時間只有一個分頁在換發（瀏覽器不支援就只在這個分頁內排隊）。 */
    withLock<T>(fn: () => Promise<T>): Promise<T> {
      const locks = (globalThis.navigator as unknown as { locks?: { request: (name: string, cb: () => Promise<unknown>) => Promise<unknown> } } | undefined)?.locks;
      return web && locks ? (locks.request(lockName, fn) as Promise<T>) : fn();
    },
    /** 別的分頁換發或登出時通知（keys＝要監看的鍵名）。 */
    onExternalChange(keys: string[], fn: () => void): void {
      if (!web || typeof globalThis.addEventListener !== "function") return;
      globalThis.addEventListener("storage", (e: StorageEvent) => {
        if (e.key === null || keys.includes(e.key)) fn();
      });
    },
    /** 舊版放在 sessionStorage 的鍵搬到 localStorage（升級時不必重新登入）。 */
    migrateFromSession(keys: string[]): void {
      if (!web) return;
      try {
        for (const k of keys) {
          const v = globalThis.sessionStorage?.getItem(k);
          if (v && !ls()?.getItem(k)) ls()?.setItem(k, v);
          globalThis.sessionStorage?.removeItem(k);
        }
      } catch {
        /* 讀不到就算了 */
      }
    },
  };
  return vault;
}

/** App 版本是否比最低版本舊（只比前三段數字）。 */
export function isOutdated(version: string, min: string): boolean {
  const parse = (x: string) => x.split(".").slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parse(version), parse(min)];
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

/** nonce 的 SHA-256（十六進位小寫）：交給中央的只有雜湊。 */
export const nonceHash = async (nonce: string) => (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce, { encoding: Crypto.CryptoEncoding.HEX })).toLowerCase();
/** 隨機字串（state 用）。 */
export const randomHex = (bytes = 24) => Array.from(Crypto.getRandomBytes(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
