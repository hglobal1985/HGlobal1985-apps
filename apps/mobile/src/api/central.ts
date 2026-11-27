import * as Crypto from "expo-crypto";
import { UPGRADING_MSG } from "../../../launch/src/contract";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { CentralError, createTokenVault, isOutdated as sharedIsOutdated } from "@/lib/central-client";
import { memberOfToken, nativeSsoEnabled, readNativeSso, writeNativeSso } from "@/lib/sso-keychain";

/**
 * 中央會員登入（登入中繼，Google）。App 不持有密碼或 client secret。
 * Access Token：記憶體＋保存（App 用安全儲存、Web 用 localStorage，重開仍有效）；Refresh Token：App 用 SecureStore、Web 用 localStorage。
 * 杜杜龍 2026-11-21：「登入一次就永久通用，除非按登出」——網頁版以前存在 sessionStorage（關分頁、關瀏覽器、iPhone 主畫面 App 被系統關掉就登出），
 * 改存 localStorage；同一個瀏覽器的所有分頁共用同一份，換發時跨分頁加鎖（navigator.locks），避免兩個分頁拿同一張舊憑證去換，被會員中心判定盜用而整個作廢。
 */
export const CENTRAL_URL = "https://id.hglobal1985.com";
export const APP_ID = "learn";
export const ACCOUNT_URL = `${CENTRAL_URL}/my/edit`;
const WEB_RETURN = "https://learn.hglobal1985.com/auth/done";
const NATIVE_RETURN = "learn://auth/google";
const REFRESH_KEY = "hglobal.learn.refresh";
const ACCESS_KEY = "hglobal.learn.access";
const ACCESS_EXP_KEY = "hglobal.learn.access-expiry";
const PENDING_KEY = "hglobal.learn.pending";
const REAUTH_KEY = "hglobal.learn.reauth";

/**
 * 「登入進行中」的暫存（杜杜龍 2026-11-21 回報：登出後再登入常出現「登入狀態已失效」）：
 * 原本只放分頁暫存（sessionStorage），登入頁跳去 Google／會員中心再回來時，如果回來的不是原本那個分頁
 * （手機的「主畫面 App」、系統在背景回收分頁、換了瀏覽器視窗），暫存就不見了。
 * 現在同時寫一份到 localStorage（同一個瀏覽器所有分頁共用）；讀取時先看分頁暫存、沒有再看 localStorage，讀完兩邊都清掉。
 * 暫存本身有時間戳記，過期（10 分鐘）一律當作失效，所以留一份在 localStorage 不會有舊資料被誤用的風險。
 */
function putTemp(key: string, value: string): void {
  try {
    globalThis.sessionStorage?.setItem(key, value);
  } catch {
    /* 沒關係 */
  }
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* 沒關係 */
  }
}
function takeTemp(key: string): string | null {
  let v: string | null = null;
  try {
    v = globalThis.sessionStorage?.getItem(key) ?? null;
    globalThis.sessionStorage?.removeItem(key);
  } catch {
    /* 沒關係 */
  }
  try {
    v = v ?? globalThis.localStorage?.getItem(key) ?? null;
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* 沒關係 */
  }
  return v;
}

type TokenPair = { access_token: string; refresh_token: string; expires_in: number };
type SignIn = TokenPair & { user: { member_id: string; status: string } };
export type AppStatus = { status: "active" | "paused" | "killed"; min_version: string };
type Pending = { nonce: string; state: string; created: number; returnTo: string; /** delete＝刪除帳號的重新驗證（不是登入） */ purpose?: "delete" };

let access: string | null = null;
let expiry = 0;
let inflight: Promise<boolean> | null = null;

// 中央錯誤：共用工具（lib/central-client.ts，與繳作業系統同一份）。
export { CentralError };

async function central<T>(path: string, method = "GET", body?: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(CENTRAL_URL + path, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new CentralError(0, "network", UPGRADING_MSG);
  }
  if (!res.ok) {
    const e = ((await res.json().catch(() => null)) as { error?: { code?: string } } | null)?.error;
    const code = e?.code ?? "central_error";
    const message =
      code === "app_unavailable" ? UPGRADING_MSG : code === "account_disabled" ? "此帳號已停用，請聯絡客服" : "登入失敗，請再試一次";
    throw new CentralError(res.status, code, message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const web = Platform.OS === "web";
const ls = (): Storage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // 無痕模式或封鎖網站資料：退回只在這次開啟期間有效
  }
};
// 舊版存在 sessionStorage 的登入：搬到 localStorage（這次升級不必重新登入）。
if (web && typeof globalThis.sessionStorage !== "undefined") {
  try {
    for (const k of ["hglobal.learn.refresh"]) {
      const v = globalThis.sessionStorage.getItem(k);
      if (v && !ls()?.getItem(k)) ls()?.setItem(k, v);
      globalThis.sessionStorage.removeItem(k);
    }
  } catch {
    /* 讀不到就算了，照常需要登入 */
  }
}
// 登入憑證的保存與跨分頁換發鎖：共用工具 createTokenVault（與繳作業系統同一份；鍵名沿用原本的，不會讓人被登出）。
const vault = createTokenVault("hglobal.learn.refresh");
const storage = { get: vault.get, set: vault.set };
/** 網頁版有沒有保存的中央登入（同步判斷，給開機流程用）。 */
export function hasSavedWebLogin(): boolean {
  return web && !!ls()?.getItem(REFRESH_KEY);
}
// 別的分頁換發或登出時，這個分頁的記憶體跟著更新（不會拿已作廢的舊憑證）。
if (web && typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("storage", (e: StorageEvent) => {
    if (e.key === ACCESS_KEY || e.key === REFRESH_KEY || e.key === null) {
      access = null;
      expiry = 0;
    }
  });
}
/** 跨分頁加鎖：同一時間只有一個分頁在換發（瀏覽器不支援就只在這個分頁內排隊）。 */
const withRefreshLock = vault.withLock;

export async function appStatus(): Promise<AppStatus> {
  return central<AppStatus>(`/v1/apps/${APP_ID}/config`);
}

/** App 版本是否比最低版本舊：共用工具（lib/central-client.ts）。 */
export const isOutdated = sharedIsOutdated;

async function remember(pair: TokenPair) {
  // 先保存新的 refresh token，再允許後續請求。
  await storage.set(REFRESH_KEY, pair.refresh_token);
  access = pair.access_token;
  expiry = Date.now() + Math.max(0, pair.expires_in - 30) * 1000;
  await storage.set(ACCESS_EXP_KEY, String(expiry));
  await storage.set(ACCESS_KEY, access);
}

export async function clearCentral(): Promise<void> {
  access = null;
  expiry = 0;
  await Promise.all([storage.set(REFRESH_KEY, null), storage.set(ACCESS_KEY, null), storage.set(ACCESS_EXP_KEY, null)]);
}

export async function hasCentralSession(): Promise<boolean> {
  return !!(access || (await storage.get(REFRESH_KEY)));
}

export async function refresh(): Promise<boolean> {
  if (inflight) return inflight;
  const stale = access;
  inflight = withRefreshLock(async () => {
    // 排隊等鎖的期間，別的分頁可能已經換好了：直接用它換來的（不要再拿舊的 refresh token 去換）。
    const [savedAccess, savedExp] = await Promise.all([storage.get(ACCESS_KEY), storage.get(ACCESS_EXP_KEY)]);
    if (savedAccess && savedAccess !== stale && Number(savedExp) > Date.now()) {
      access = savedAccess;
      expiry = Number(savedExp);
      return true;
    }
    const rt = await storage.get(REFRESH_KEY);
    if (!rt) return false;
    try {
      await remember(await central<TokenPair>("/v1/auth/refresh", "POST", { refresh_token: rt }));
      return true;
    } catch (e) {
      // 網路問題時保留登入；其他錯誤（含 refresh_reused、過期）清除，下次開頁面會向會員中心做共用登入檢查，會員中心還登入著就自動登回來。
      if (!(e instanceof CentralError && e.status === 0)) {
        await clearCentral();
        forgetSsoCheck();
      }
      return false;
    }
  });
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** 取得有效的 Access Token（必要時換發）；沒有中央登入時回傳 null。 */
export async function centralToken(): Promise<string | null> {
  if (access && Date.now() < expiry) return access;
  const [saved, exp] = await Promise.all([storage.get(ACCESS_KEY), storage.get(ACCESS_EXP_KEY)]);
  if (saved && Number(exp) > Date.now()) {
    access = saved;
    expiry = Number(exp);
    return access;
  }
  return (await refresh()) ? access : null;
}

const randomHex = () => Array.from(Crypto.getRandomBytes(24), (b) => b.toString(16).padStart(2, "0")).join("");
const safePath = (p: string) => (p.startsWith("/") && !p.startsWith("//") && !p.includes("\\") ? p : "/");

/** 開始 Google 登入。Web 會整頁導向（回傳 "redirecting"）；App 開系統登入視窗。 */
export async function signInWithGoogle(returnTo = "/me"): Promise<"ok" | "cancelled" | "redirecting"> {
  const status = await appStatus();
  if (status.status !== "active") throw new CentralError(503, "app_unavailable", UPGRADING_MSG);
  const { nonce } = await central<{ nonce: string }>("/v1/auth/nonce", "POST", { app_id: APP_ID });
  const pending: Pending = { nonce, state: randomHex(), created: Date.now(), returnTo: safePath(returnTo) };
  const digest = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce)).toLowerCase();
  const url = new URL(`${CENTRAL_URL}/auth/google/start`);
  url.searchParams.set("app_id", APP_ID);
  url.searchParams.set("nonce", digest);
  url.searchParams.set("return", web ? WEB_RETURN : NATIVE_RETURN);
  url.searchParams.set("state", pending.state);
  if (web) {
    putTemp(PENDING_KEY, JSON.stringify(pending));
    globalThis.location.assign(url.toString());
    return "redirecting";
  }
  const result = await WebBrowser.openAuthSessionAsync(url.toString(), NATIVE_RETURN);
  if (result.type !== "success") return "cancelled";
  const back = new URL(result.url);
  if (back.protocol !== "learn:" || back.hostname !== "auth" || back.pathname !== "/google") throw new CentralError(400, "bad_return", "登入回傳網址無效");
  await finish(back.searchParams, pending);
  await nativeSsoStart();
  return "ok";
}

async function finish(params: URLSearchParams, pending: Pending): Promise<void> {
  // 行動大學這端不再限制登入要在幾分鐘內完成（杜杜龍 2026-11-21 取消登入逾時）；一次性的 nonce／state 是否有效由會員中心判斷。
  if (params.get("state") !== pending.state) throw new CentralError(400, "state", "登入驗證失敗，請重新登入");
  if (params.get("error")) throw new CentralError(400, "cancelled", "登入已取消");
  const idToken = params.get("id_token");
  if (!idToken) throw new CentralError(400, "no_token", "沒有取得登入資料，請重新登入");
  const data = await central<SignIn>("/v1/auth/google", "POST", { app_id: APP_ID, id_token: idToken, nonce: pending.nonce });
  if (data.user.status !== "active") {
    await clearCentral();
    throw new CentralError(403, "inactive", "此帳號尚未啟用");
  }
  await remember(data);
}

/** Web：在 /auth/done 讀取 fragment 完成登入，回傳登入前的頁面。 */
export async function finishWebReturn(): Promise<string> {
  const fragment = globalThis.location.hash.slice(1);
  globalThis.history.replaceState(null, "", globalThis.location.pathname);
  const raw = takeTemp(PENDING_KEY);
  if (!raw) throw new CentralError(400, "no_pending", "登入狀態已失效，請重新登入");
  const pending = JSON.parse(raw) as Pending;
  if (pending.purpose === "delete") {
    // 刪除帳號的重新驗證：拿到 reauth_token 先暫存，由 /auth/done 接著呼叫刪除（10 分鐘內有效）。
    const token = await reauthFrom(new URLSearchParams(fragment), pending);
    putTemp(REAUTH_KEY, JSON.stringify({ token, at: Date.now() }));
    return safePath(pending.returnTo);
  }
  await finish(new URLSearchParams(fragment), pending);
  return safePath(pending.returnTo);
}

// ---------- 刪除帳號的重新驗證（中央串接指令 2026-11-23.3，三、9）----------
// 會員再按一次 Google 登入 → id_token 連同 nonce 送 POST /v1/auth/reauth（帶會員自己的 Access Token）→ reauth_token（10 分鐘，只能用來刪帳號）。

async function reauthFrom(params: URLSearchParams, pending: Pending): Promise<string> {
  if (params.get("state") !== pending.state) throw new CentralError(400, "state", "驗證失敗，請重新操作一次");
  if (params.get("error")) throw new CentralError(400, "cancelled", "已取消，帳號沒有刪除");
  const idToken = params.get("id_token");
  if (!idToken) throw new CentralError(400, "no_token", "沒有取得驗證資料，請重新操作一次");
  const token = await centralToken();
  if (!token) throw new CentralError(401, "unauthenticated", "登入已過期，請重新登入後再刪除帳號");
  try {
    return (await central<{ reauth_token: string }>("/v1/auth/reauth", "POST", { id_token: idToken, nonce: pending.nonce }, token)).reauth_token;
  } catch (e) {
    if (e instanceof CentralError && e.status === 403) throw new CentralError(403, e.code, "請用登入時的同一個 Google 帳號重新驗證");
    throw e instanceof CentralError && e.status === 0 ? e : new CentralError(e instanceof CentralError ? e.status : 400, "reauth_failed", "重新驗證失敗，帳號沒有刪除，請再試一次");
  }
}

/** 開始刪除帳號的重新驗證。手機：開登入視窗，成功回傳 reauthToken；網頁：整頁導向（回來後由 /auth/done 接手，用 takeReauthToken 取得）。 */
export async function startDeleteReauth(): Promise<{ status: "ok"; reauthToken: string } | { status: "cancelled" | "redirecting" }> {
  const status = await appStatus();
  if (status.status !== "active") throw new CentralError(503, "app_unavailable", UPGRADING_MSG);
  const { nonce } = await central<{ nonce: string }>("/v1/auth/nonce", "POST", { app_id: APP_ID });
  const pending: Pending = { nonce, state: randomHex(), created: Date.now(), returnTo: "/me", purpose: "delete" };
  const digest = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce)).toLowerCase();
  const url = new URL(`${CENTRAL_URL}/auth/google/start`);
  url.searchParams.set("app_id", APP_ID);
  url.searchParams.set("nonce", digest);
  url.searchParams.set("return", web ? WEB_RETURN : NATIVE_RETURN);
  url.searchParams.set("state", pending.state);
  url.searchParams.set("purpose", "delete_account");
  if (web) {
    putTemp(PENDING_KEY, JSON.stringify(pending));
    globalThis.location.assign(url.toString());
    return { status: "redirecting" };
  }
  const result = await WebBrowser.openAuthSessionAsync(url.toString(), NATIVE_RETURN);
  if (result.type !== "success") return { status: "cancelled" };
  const back = new URL(result.url);
  if (back.protocol !== "learn:" || back.hostname !== "auth" || back.pathname !== "/google") throw new CentralError(400, "bad_return", "驗證回傳網址無效");
  return { status: "ok", reauthToken: await reauthFrom(back.searchParams, pending) };
}

/** 網頁版：重新驗證回來後取出暫存的 reauth_token（只能用一次、超過 10 分鐘失效）。 */
export function takeReauthToken(): string | null {
  const raw = takeTemp(REAUTH_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { token?: string; at?: number };
    return v.token && Date.now() - (v.at ?? 0) < 10 * 60_000 ? v.token : null;
  } catch {
    return null;
  }
}

/** 登出。all＝true：登出所有 App、所有裝置與會員中心網站（POST /v1/auth/logout-all）；否則只登出這個 App 的這次登入。 */
export async function signOutCentral(all = false): Promise<void> {
  const token = access ?? (await storage.get(ACCESS_KEY));
  if (token && all) {
    try {
      await central("/v1/auth/logout-all", "POST", undefined, token);
    } catch {
      // 存取權杖（15 分鐘）過期時先換發一次，再登出所有 App。
      if (await refresh().catch(() => false)) {
        const fresh = access;
        if (fresh) await central("/v1/auth/logout-all", "POST", undefined, fresh).catch(() => undefined);
      }
    }
  } else if (token) await central("/v1/auth/logout", "POST", undefined, token).catch(() => undefined);
  if (!web) {
    // 手機共用登入：「登出所有 App」連同這支裝置上所有 H-Global1985 App 一起登出；只登出這個 App 時也清掉共用登入，免得下次開啟又自動登回來。
    const sso = await readNativeSso();
    if (sso && all) await central("/v1/auth/sso/logout", "POST", { sso_token: sso }).catch(() => undefined);
    await writeNativeSso(null);
  }
  await clearCentral();
}

// ---------- 共用登入（手機 App，iPhone 共用 Keychain；中央串接指令 三、2；杜杜龍 2026-11-27 補上）----------
// 登入成功後 sso/start 取得 sso_token 存進共用 Keychain（共用元件 lib/sso-keychain.ts，與寰宇繳作業系統同一份）；
// 開啟與每次回到前景：沒登入就 exchange（在別的 App 登入過就自動登入），已登入就 status 檢查（失效或換人就清掉）。

/** 登入成功後建立手機共用登入（失敗不影響這個 App 的登入）。 */
async function nativeSsoStart(): Promise<void> {
  if (web || !nativeSsoEnabled() || !access) return;
  try {
    const prev = await readNativeSso();
    const { sso_token } = await central<{ sso_token: string }>("/v1/auth/sso/start", "POST", prev ? { previous_sso_token: prev } : {}, access);
    await writeNativeSso(sso_token);
  } catch {
    /* 共用登入失敗不影響這個 App */
  }
}

const deviceLabel = () => (Platform.OS === "ios" ? "iPhone App" : "Android App");

/**
 * 手機共用登入檢查（只在手機 App；測試身分登入時不要呼叫）。
 * 回傳 true 表示登入狀態有變（自動登入、被登出或換人），呼叫端要重新抓會員資料。
 */
export async function nativeSsoCheck(): Promise<boolean> {
  if (web || !nativeSsoEnabled()) return false;
  const sso = await readNativeSso();
  if (!sso) return false;
  const token = await centralToken().catch(() => null);
  const currentSub = token ? memberOfToken(token) : null;
  const exchange = async () => {
    const data = await central<SignIn>("/v1/auth/sso/exchange", "POST", { app_id: APP_ID, sso_token: sso, device_label: deviceLabel() });
    if (data.user.status === "active") await remember(data);
  };
  try {
    if (!currentSub) {
      await exchange();
      return true;
    }
    const s = await central<{ active: boolean; member_id: string }>("/v1/auth/sso/status", "POST", { sso_token: sso });
    if (s.active && s.member_id === currentSub) return false;
    await clearCentral();
    if (s.active) await exchange();
    return true;
  } catch (e) {
    if (e instanceof CentralError && e.code === "invalid_sso") {
      await writeNativeSso(null);
      if (currentSub) {
        await clearCentral();
        return true;
      }
    }
    return false;
  }
}

// ---------- 共用登入（網頁版，同一個瀏覽器內連動）----------
// 會員中心記住這個瀏覽器；本站以整頁導向詢問（/auth/sso/check），回到 /auth/sso 處理結果。

const SSO_RETURN = "https://learn.hglobal1985.com/auth/sso";
const SSO_CHECKED = "hglobal.learn.sso-checked";
const SSO_PENDING = "hglobal.learn.sso-pending";
const SSO_NEXT = "hglobal.learn.sso-next";
const SSO_INTERVAL = 5 * 60_000;
type SsoPending = { nonce: string; state: string; created: number };

const ss = () => globalThis.sessionStorage;
const here = () => safePath(globalThis.location.pathname + globalThis.location.search);

/** 這次載入頁面是否會去會員中心做共用登入檢查（會整頁導向離開再回來）：會的話，開機預先抓資料就白抓了（2026-11-21）。 */
export function webSsoCheckDue(): boolean {
  if (!web || !globalThis.location || globalThis.location.hostname !== "learn.hglobal1985.com") return false;
  if (globalThis.location.pathname.startsWith("/auth/")) return false;
  if (hasSavedWebLogin()) return false; // 已登入：不再每次跳去會員中心檢查（杜杜龍 2026-11-21）
  return Date.now() - Number(ss()?.getItem(SSO_CHECKED) ?? 0) >= SSO_INTERVAL;
}

/** 登入失效時呼叫：下次開頁面立刻向會員中心做共用登入檢查（不等 5 分鐘）。 */
function forgetSsoCheck() {
  try {
    ss()?.removeItem(SSO_CHECKED);
  } catch {
    /* 沒關係 */
  }
}

/** 載入頁面時（5 分鐘節流）向會員中心詢問這個瀏覽器目前登入的會員。會整頁導向時回傳 true。 */
export async function webSsoCheck(): Promise<boolean> {
  if (!web || !globalThis.location || globalThis.location.hostname !== "learn.hglobal1985.com") return false;
  if (globalThis.location.pathname.startsWith("/auth/")) return false;
  if (hasSavedWebLogin()) return false;
  const last = Number(ss()?.getItem(SSO_CHECKED) ?? 0);
  if (Date.now() - last < SSO_INTERVAL) return false;
  ss()?.setItem(SSO_CHECKED, String(Date.now()));
  try {
    const { nonce } = await central<{ nonce: string }>("/v1/auth/nonce", "POST", { app_id: APP_ID });
    const pending: SsoPending = { nonce, state: randomHex(), created: Date.now() };
    putTemp(SSO_PENDING, JSON.stringify(pending));
    putTemp(SSO_NEXT, here());
    const digest = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce)).toLowerCase();
    const url = new URL(`${CENTRAL_URL}/auth/sso/check`);
    url.searchParams.set("app_id", APP_ID);
    url.searchParams.set("nonce", digest);
    url.searchParams.set("return", SSO_RETURN);
    url.searchParams.set("state", pending.state);
    globalThis.location.replace(url.toString());
    return true;
  } catch {
    return false; // 會員中心連不上：照常使用，需要登入的功能由伺服器拒絕。
  }
}

/**
 * 處理 /auth/sso 的回傳（#sso_code／#sso_none／#sso_adopted），回傳之後要前往的頁面。
 * currentMember：本機目前登入的會員 ID（沒有則 null）。
 */
export async function handleWebSsoReturn(currentMember: string | null): Promise<{ next: string; changed: boolean }> {
  const params = new URLSearchParams(globalThis.location.hash.slice(1));
  globalThis.history.replaceState(null, "", globalThis.location.pathname);
  const next = safePath(takeTemp(SSO_NEXT) ?? "/");
  const raw = takeTemp(SSO_PENDING);
  const pending = raw ? (JSON.parse(raw) as SsoPending) : null;
  if (params.get("sso_adopted")) return { next, changed: false };
  if (!pending || params.get("state") !== pending.state ) return { next, changed: false };
  if (params.get("sso_none")) {
    if (currentMember) {
      await clearCentral();
      return { next, changed: true };
    }
    return { next, changed: false };
  }
  const code = params.get("sso_code");
  const member = params.get("sso_member");
  if (!code || (member && member === currentMember)) return { next, changed: false };
  try {
    await remember(await central<TokenPair>("/v1/auth/sso/web-exchange", "POST", { app_id: APP_ID, code, nonce: pending.nonce }));
    return { next, changed: true };
  } catch {
    return { next, changed: false };
  }
}

/** 網頁版登入成功後：讓會員中心記住這個瀏覽器（之後其他 App 自動登入）。會整頁導向。 */
export async function webSsoAdopt(next: string): Promise<boolean> {
  if (!web) return false;
  try {
    const token = await centralToken();
    if (!token) return false;
    const { sso_token } = await central<{ sso_token: string }>("/v1/auth/sso/start", "POST", {}, token);
    const { code } = await central<{ code: string }>("/v1/auth/sso/web-code", "POST", { sso_token }, token);
    putTemp(SSO_NEXT, safePath(next));
    ss()?.setItem(SSO_CHECKED, String(Date.now()));
    const url = new URL(`${CENTRAL_URL}/auth/sso/adopt`);
    url.searchParams.set("c", code);
    url.searchParams.set("app_id", APP_ID);
    url.searchParams.set("return", SSO_RETURN);
    globalThis.location.replace(url.toString());
    return true;
  } catch {
    return false;
  }
}

/**
 * 開啟完整版會員中心（杜杜龍 2026-11-24；中央串接指令 2026-11-24.1 檢查清單 37）：已登入就不再要求選 Google 帳號。
 * 每次都先取新的 sso_token → web-code（單次、2 分鐘，不快取）→ 用 /auth/sso/adopt 開啟，return 固定 /my/edit；
 * 任何一步失敗（沒登入、連不上）才直接開 /my/edit。回傳要開啟的網址。
 */
export async function accountCenterUrl(): Promise<string> {
  try {
    const token = await centralToken();
    if (!token) return ACCOUNT_URL;
    const { sso_token } = await central<{ sso_token: string }>("/v1/auth/sso/start", "POST", {}, token);
    const { code } = await central<{ code: string }>("/v1/auth/sso/web-code", "POST", { sso_token }, token);
    const url = new URL(`${CENTRAL_URL}/auth/sso/adopt`);
    url.searchParams.set("c", code);
    url.searchParams.set("app_id", APP_ID);
    url.searchParams.set("return", ACCOUNT_URL);
    return url.toString();
  } catch {
    return ACCOUNT_URL;
  }
}

/** 網頁版登出：清除本機後導向會員中心登出這個瀏覽器的所有 App。 */
export function webSsoLogout(next = "/me"): void {
  if (!web) return;
  putTemp(SSO_NEXT, safePath(next));
  ss()?.setItem(SSO_CHECKED, String(Date.now()));
  const url = new URL(`${CENTRAL_URL}/auth/sso/logout`);
  url.searchParams.set("app_id", APP_ID);
  url.searchParams.set("return", SSO_RETURN);
  globalThis.location.replace(url.toString());
}
