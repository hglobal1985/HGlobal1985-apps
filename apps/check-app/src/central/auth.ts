/**
 * 中央會員登入（串接指令 三、2）：登入中繼（Google）、Token 保存與換發、共用登入、登出所有 App、刪除帳號。
 * - 手機：Access／Refresh Token 都放系統安全儲存（expo-secure-store）。
 * - 網頁：登入永不過期（中央串接指令 2026-11-27.1，杜杜龍決定）：Refresh Token 與 Access Token 放 localStorage（關分頁、關瀏覽器都還是登入）；
 *   同一個瀏覽器的分頁共用一份，換發時跨分頁加鎖（navigator.locks），避免兩個分頁拿同一張舊憑證去換而被判定盜用。
 * - 換發同一時間只跑一個（加鎖）；新的 Refresh Token 立刻覆蓋舊的；refresh_reused／invalid 就回登入畫面。
 */
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { CentralError, createCentralRequest, createTokenVault, isOutdated } from "@/lib/central-client";
import { memberOfToken, nativeSsoEnabled, readNativeSso, writeNativeSso } from "@/lib/sso-keychain";
import { APP_ID, CENTRAL_URL, NATIVE_RETURN, WEB_ORIGIN } from "./config";

const web = Platform.OS === "web";
const K = { access: "check.access", accessExp: "check.access-exp", refresh: "check.refresh", pending: "check.pending", ssoWeb: "check.sso", ssoCheckAt: "check.sso-check-at", back: "check.back" };

export { CentralError };
/** 呼叫中央 API：共用工具（lib/central-client.ts，與行動大學同一份）。 */
const central = createCentralRequest(CENTRAL_URL);

// ───── 儲存 ─────
const ss = () => {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
};
// 登入憑證：共用工具 createTokenVault（手機放系統安全儲存、網頁放 localStorage，登入永不過期；跨分頁換發鎖）。
const vault = createTokenVault("hglobal.check.refresh");
vault.migrateFromSession(["check.refresh"]); // 舊版放在 sessionStorage 的登入搬過來（不必重新登入）
const store = { get: vault.get, set: vault.set };

/** 共用登入的 sso_token：iPhone 放共用 Keychain 群組（共用元件 lib/sso-keychain.ts，與行動大學同一份）；網頁放 sessionStorage。 */
const ssoStore = {
  enabled: () => web || nativeSsoEnabled(),
  async get(): Promise<string | null> {
    return web ? (ss()?.getItem(K.ssoWeb) ?? null) : readNativeSso();
  },
  async set(v: string | null): Promise<void> {
    if (!web) return writeNativeSso(v);
    if (v) ss()?.setItem(K.ssoWeb, v);
    else ss()?.removeItem(K.ssoWeb);
  },
};

type Tokens = { access_token: string; refresh_token: string; expires_in: number; user?: { member_id: string } };
let access: string | null = null;
let accessExp = 0;
let memberId: string | null = null;
let inflight: Promise<boolean> | null = null;
const listeners = new Set<() => void>();
export const onAuthChange = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const emit = () => listeners.forEach((f) => f());

const memberOf = memberOfToken;

async function saveTokens(t: Tokens): Promise<void> {
  access = t.access_token;
  accessExp = Date.now() + Math.max(60, t.expires_in - 30) * 1000;
  memberId = t.user?.member_id ?? memberOf(t.access_token);
  await store.set(K.refresh, t.refresh_token);
  await store.set(K.access, t.access_token);
  await store.set(K.accessExp, String(accessExp));
}
async function clearLocal(): Promise<void> {
  access = null;
  accessExp = 0;
  memberId = null;
  await store.set(K.refresh, null);
  await store.set(K.access, null);
  await store.set(K.accessExp, null);
}

/** 開機：讀回保存的登入（手機），網頁只有 Refresh Token。 */
export async function restore(): Promise<boolean> {
  {
    const a = await store.get(K.access);
    const exp = Number((await store.get(K.accessExp)) ?? 0);
    if (a && exp > Date.now()) {
      access = a;
      accessExp = exp;
      memberId = memberOf(a);
      return true;
    }
  }
  if (await store.get(K.refresh)) return refresh();
  return false;
}

export const currentMember = () => memberId;
export const isSignedIn = () => !!memberId;

/** 換發（加鎖）。成功回 true；被撤銷或失效就清掉登入回 false。 */
const withRefreshLock = vault.withLock;
// 別的分頁換發或登出時，這個分頁的記憶體跟著更新（不會拿已作廢的舊憑證）。
vault.onExternalChange([K.access, K.refresh], () => {
  access = null;
  accessExp = 0;
});

export function refresh(): Promise<boolean> {
  if (inflight) return inflight;
  const stale = access;
  inflight = withRefreshLock(async () => {
    // 排隊等鎖的期間，別的分頁可能已經換好了：直接用它換來的。
    const savedAccess = await store.get(K.access);
    const savedExp = Number((await store.get(K.accessExp)) ?? 0);
    if (savedAccess && savedAccess !== stale && savedExp > Date.now()) {
      access = savedAccess;
      accessExp = savedExp;
      memberId = memberOf(savedAccess);
      return true;
    }
    const rt = await store.get(K.refresh);
    if (!rt) return false;
    try {
      const t = await central<Tokens>("/v1/auth/refresh", "POST", { refresh_token: rt });
      await saveTokens(t);
      return true;
    } catch (e) {
      if (e instanceof CentralError && (e.status === 401 || e.status === 400)) {
        await clearLocal();
        emit();
      }
      return false;
    } finally {
      setTimeout(() => (inflight = null), 0);
    }
  });
  return inflight;
}

/** 取得可用的 Access Token（快過期就先換發）。 */
export async function accessToken(): Promise<string | null> {
  if (access && accessExp > Date.now()) return access;
  if (await refresh()) return access;
  return null;
}

// ───── 登入中繼 ─────
const hex = (s: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s, { encoding: Crypto.CryptoEncoding.HEX });
const randomState = () => Crypto.randomUUID().replace(/-/g, "");
const deviceLabel = () => (web ? "網頁版" : Platform.OS === "ios" ? "iPhone App" : "Android App");
const webReturn = `${WEB_ORIGIN}/auth/done`;

type Pending = { nonce: string; state: string; purpose: "login" | "delete" | "sso"; back: string; created: number };
async function startRelay(purpose: Pending["purpose"]): Promise<{ startUrl: string; pending: Pending }> {
  const { nonce } = await central<{ nonce: string }>("/v1/auth/nonce", "POST", { app_id: APP_ID });
  const state = randomState();
  const back = web ? location.pathname + location.search : "/";
  const pending: Pending = { nonce, state, purpose, back, created: Date.now() };
  const ret = web ? webReturn : NATIVE_RETURN;
  const path = purpose === "sso" ? "/auth/sso/check" : "/auth/google/start";
  const startUrl =
    `${CENTRAL_URL}${path}?app_id=${APP_ID}&nonce=${await hex(nonce)}&return=${encodeURIComponent(ret)}&state=${state}` + (purpose === "delete" ? "&purpose=delete_account" : "");
  return { startUrl, pending };
}

/** 網頁版是否在登記的網址上（其他網址中央不接受登入回傳）。 */
export const webLoginAvailable = () => !web || location.origin === WEB_ORIGIN;

/** 按「使用 Google 登入」。手機：系統登入視窗；網頁：整頁導向。 */
export async function signIn(): Promise<boolean> {
  const { startUrl, pending } = await startRelay("login");
  if (web) {
    ss()?.setItem(K.pending, JSON.stringify(pending));
    location.assign(startUrl);
    return false;
  }
  const r = await WebBrowser.openAuthSessionAsync(startUrl, NATIVE_RETURN);
  if (r.type !== "success") return false;
  const q = new URL(r.url).searchParams;
  if (q.get("state") !== pending.state) throw new CentralError(400, "state", "登入逾時，請再試一次");
  if (q.get("error") || !q.get("id_token")) throw new CentralError(400, q.get("error") ?? "cancelled", "登入沒有完成，請再試一次");
  const t = await central<Tokens>("/v1/auth/google", "POST", { app_id: APP_ID, id_token: q.get("id_token"), nonce: pending.nonce, device_label: deviceLabel() });
  await saveTokens(t);
  await ssoStart();
  emit();
  return true;
}

/** 登入後：建立共用登入（手機存共用 Keychain；網頁讓中央記住這個瀏覽器）。 */
async function ssoStart(): Promise<string | null> {
  if (!ssoStore.enabled() || !access) return null;
  try {
    const prev = await ssoStore.get();
    const { sso_token } = await central<{ sso_token: string }>("/v1/auth/sso/start", "POST", prev ? { previous_sso_token: prev } : {}, access);
    await ssoStore.set(sso_token);
    return sso_token;
  } catch {
    return null;
  }
}

/**
 * 網頁：處理從中央回來的 /auth/done#…（登入、共用登入檢查、刪除帳號的重新驗證）。
 * 回傳要導回的頁面路徑；不是中央回傳就回 null。
 */
export async function handleWebReturn(): Promise<{ back: string; deleteReauth?: { idToken: string; nonce: string } } | null> {
  if (!web) return null;
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  if (!hash) return null;
  const q = new URLSearchParams(hash);
  history.replaceState(null, "", location.pathname + location.search);
  if (q.get("sso_adopted")) return { back: ss()?.getItem(K.back) ?? "/" };
  const raw = ss()?.getItem(K.pending);
  ss()?.removeItem(K.pending);
  const pending = raw ? (JSON.parse(raw) as Pending) : null;
  if (!pending || pending.state !== q.get("state") || Date.now() - pending.created > 600_000) throw new CentralError(400, "state", "登入逾時，請再試一次");
  if (pending.purpose === "sso") {
    if (q.get("sso_none")) {
      if (memberId) await clearLocal();
      emit();
      return { back: pending.back };
    }
    const code = q.get("sso_code");
    const who = q.get("sso_member");
    if (code && who && who !== memberId) {
      const t = await central<Tokens>("/v1/auth/sso/web-exchange", "POST", { app_id: APP_ID, code, nonce: pending.nonce });
      await saveTokens(t);
      emit();
    }
    return { back: pending.back };
  }
  if (q.get("error") || !q.get("id_token")) throw new CentralError(400, q.get("error") ?? "cancelled", "登入沒有完成，請再試一次");
  if (pending.purpose === "delete") return { back: pending.back, deleteReauth: { idToken: q.get("id_token")!, nonce: pending.nonce } };
  const t = await central<Tokens>("/v1/auth/google", "POST", { app_id: APP_ID, id_token: q.get("id_token"), nonce: pending.nonce, device_label: deviceLabel() });
  await saveTokens(t);
  ss()?.setItem(K.ssoCheckAt, String(Date.now())); // 剛登入，不用馬上再問一次共用登入
  emit();
  // 讓中央記住這個瀏覽器（其他 H-Global1985 網頁版自動登入）
  const sso = await ssoStart();
  if (sso) {
    try {
      const { code } = await central<{ code: string }>("/v1/auth/sso/web-code", "POST", { sso_token: sso });
      ss()?.setItem(K.back, pending.back);
      location.assign(`${CENTRAL_URL}/auth/sso/adopt?c=${code}&app_id=${APP_ID}&return=${encodeURIComponent(webReturn)}`);
      return { back: "" };
    } catch {
      /* 共用登入失敗不影響這個 App */
    }
  }
  return { back: pending.back };
}

/**
 * 啟動與回到前景的共用登入檢查。
 * - 手機：有 sso_token 而自己沒登入 → exchange；已登入 → status，不同人或失效就清掉（不同人再 exchange）。
 * - 網頁：每次載入頁面（5 分鐘節流）整頁導向中央詢問；回傳 true 表示已導向。
 */
export async function ssoCheck(): Promise<boolean> {
  if (web) {
    if (!webLoginAvailable() || location.pathname.startsWith("/auth/")) return false;
    const last = Number(ss()?.getItem(K.ssoCheckAt) ?? 0);
    if (Date.now() - last < 300_000) return false;
    ss()?.setItem(K.ssoCheckAt, String(Date.now()));
    try {
      const { startUrl, pending } = await startRelay("sso");
      ss()?.setItem(K.pending, JSON.stringify(pending));
      location.assign(startUrl);
      return true;
    } catch {
      return false;
    }
  }
  const sso = await ssoStore.get();
  if (!sso) return false;
  try {
    if (!memberId) {
      const t = await central<Tokens>("/v1/auth/sso/exchange", "POST", { app_id: APP_ID, sso_token: sso, device_label: deviceLabel() });
      await saveTokens(t);
      emit();
      return false;
    }
    const s = await central<{ active: boolean; member_id: string }>("/v1/auth/sso/status", "POST", { sso_token: sso });
    if (!s.active || s.member_id !== memberId) {
      await clearLocal();
      if (s.active) {
        const t = await central<Tokens>("/v1/auth/sso/exchange", "POST", { app_id: APP_ID, sso_token: sso, device_label: deviceLabel() });
        await saveTokens(t);
      }
      emit();
    }
  } catch (e) {
    if (e instanceof CentralError && e.code === "invalid_sso") {
      await ssoStore.set(null);
      await clearLocal();
      emit();
    }
  }
  return false;
}

/** 「登出所有 App」。 */
export async function signOutAll(): Promise<void> {
  const token = access;
  const sso = await ssoStore.get();
  try {
    if (token) await central("/v1/auth/logout", "POST", {}, token);
  } catch {
    /* 照樣清除本機 */
  }
  if (!web && sso) {
    try {
      await central("/v1/auth/sso/logout", "POST", { sso_token: sso });
    } catch {
      /* 照樣清除 */
    }
  }
  await ssoStore.set(null);
  await clearLocal();
  emit();
  if (web && webLoginAvailable()) location.assign(`${CENTRAL_URL}/auth/sso/logout?app_id=${APP_ID}&return=${encodeURIComponent(WEB_ORIGIN + "/")}`);
}

/** 開啟完整版會員中心（已有共用登入就不用再選 Google 帳號）。 */
export async function openMemberCenter(): Promise<void> {
  const target = `${CENTRAL_URL}/my/edit`;
  let url = target;
  const sso = await ssoStore.get();
  if (sso) {
    try {
      const { code } = await central<{ code: string }>("/v1/auth/sso/web-code", "POST", { sso_token: sso });
      url = `${CENTRAL_URL}/auth/sso/adopt?c=${code}&app_id=${APP_ID}&return=${encodeURIComponent(target)}`;
    } catch {
      url = target;
    }
  }
  if (web) location.assign(url);
  else await WebBrowser.openBrowserAsync(url);
}

/**
 * 刪除帳號（串接指令 三、9）：重新驗證 → reauth_token → delete-account。
 * 網頁版會整頁導向中央再回來（回來後呼叫 finishDeleteAccount）。手機版一次完成。
 */
export async function deleteAccount(): Promise<"done" | "redirected" | "cancelled"> {
  const { startUrl, pending } = await startRelay("delete");
  if (web) {
    ss()?.setItem(K.pending, JSON.stringify(pending));
    location.assign(startUrl);
    return "redirected";
  }
  const r = await WebBrowser.openAuthSessionAsync(startUrl, NATIVE_RETURN);
  if (r.type !== "success") return "cancelled";
  const q = new URL(r.url).searchParams;
  if (q.get("state") !== pending.state || !q.get("id_token")) throw new CentralError(400, "cancelled", "確認身分沒有完成，請再試一次");
  await finishDeleteAccount(q.get("id_token")!, pending.nonce);
  return "done";
}
export async function finishDeleteAccount(idToken: string, nonce: string): Promise<void> {
  const token = await accessToken();
  if (!token) throw new CentralError(401, "unauthenticated", "請先登入");
  const { reauth_token } = await central<{ reauth_token: string }>("/v1/auth/reauth", "POST", { id_token: idToken, nonce }, token);
  await central("/v1/me/delete-account", "POST", { reauth_token }, token);
  await ssoStore.set(null);
  await clearLocal();
  emit();
}

/** 啟動檢查（串接指令 三、1）。連不上回 null（不需要登入的畫面照常）。 */
export type AppStatus = { status: "active" | "paused" | "killed"; min_version: string };
export async function appConfig(): Promise<AppStatus | null> {
  try {
    return await central<AppStatus>(`/v1/apps/${APP_ID}/config`);
  } catch {
    return null;
  }
}
/** App 版本是否比最低版本舊：共用工具（lib/central-client.ts）。 */
export const olderThan = isOutdated;

/** 本機測試用登入（只有在開發模式、非正式網址、伺服器 DEV_LOGIN=on 時有效）。 */
export async function devSignIn(member: string): Promise<void> {
  access = `dev:${member}`;
  accessExp = Date.now() + 86400_000;
  memberId = member;
  if (web) ss()?.setItem("check.dev", member);
  emit();
}
export function restoreDev(): boolean {
  if (!web || webLoginAvailable()) return false;
  const m = ss()?.getItem("check.dev");
  if (!m) return false;
  access = `dev:${m}`;
  accessExp = Date.now() + 86400_000;
  memberId = m;
  return true;
}
export function devSignOut(): void {
  ss()?.removeItem("check.dev");
  access = null;
  memberId = null;
  emit();
}
