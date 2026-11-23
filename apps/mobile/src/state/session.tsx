import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { setFeatureTrackSignedIn } from "@/lib/feature-track";
import { markOwnerDevice } from "@/lib/usage";
import { clearCentral, handleWebSsoReturn, hasCentralSession, refresh as refreshCentral, signInWithGoogle, signOutCentral, webSsoCheck, webSsoCheckDue, webSsoLogout } from "@/api/central";
import { api, cachedGet, clearApiCache, loadToken, peekCache, prefetchCommon, saveToken, type Member } from "@/api/client";

/**
 * 登入狀態、資料重新整理訊號與（Web 限定的）報名清單。
 * 正式登入：中央會員（Google）；內部測試另有模擬會員（伺服器開啟 DEMO_LOGIN 時才可用）。
 * 任何會改變資料的動作完成後呼叫 `invalidate()`，所有畫面會重新抓資料。
 */
type Session = {
  ready: boolean;
  member: Member | null;
  /** returnTo：登入完成後要回到的頁面。 */
  signInGoogle: (returnTo?: string) => Promise<void>;
  signInDemo: (sub: string) => Promise<void>;
  /** Web 登入回來後（/auth/done）重新載入會員。 */
  reloadMember: () => Promise<void>;
  /** 重新向會員中心拿最新的會員資料與獎銜（下拉重新整理、進入設定頁用）；距離上次更新不到 minGapMs 毫秒就略過。 */
  refreshMember: (minGapMs?: number) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  /** 中央會員：App 內直接刪除帳號（中央串接指令 2026-11-23.3）；reauthToken 來自剛完成的重新驗證。成功後本機資料、登入全部清掉。 */
  deleteCentralAccount: (reauthToken: string) => Promise<void>;
  version: number;
  invalidate: () => void;
  cart: string[];
  setCart: (ids: string[]) => void;
  /** Web 共用登入回傳（/auth/sso）處理完後要前往的頁面。 */
  ssoNext: string | null;
};

const SessionContext = createContext<Session | null>(null);
const CART_KEY = "hglobal:learn:cart";

/** 取得目前登入的會員。連線失敗時重試一次；仍失敗回傳 "offline"（不可因此清除登入）。 */
async function fetchMember(): Promise<Member | null | "offline"> {
  for (let i = 0; i < 2; i++) {
    try {
      // fresh=1：每次開啟 App、重新整理、回到前景都向會員中心拿最新資料（獎銜剛審核通過時才會立刻更新）。
      return (await api<{ member: Member | null }>("GET", "/me?fresh=1")).member;
    } catch {
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  return "offline";
}
const known = (m: Member | null | "offline"): Member | null => (m === "offline" ? null : m);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [member, setMember] = useState<Member | null>(null);
  const [version, setVersion] = useState(0);
  const [cart, setCartState] = useState<string[]>([]);
  const [ssoNext, setSsoNext] = useState<string | null>(null);

  useEffect(() => {
    // 跟登入檢查同時開始抓公開資料，頁面一出現就有內容（不必等 /me 回來才開始）。
    // 這次會先去會員中心做共用登入檢查（整頁離開再回來）時不預先抓：回來後頁面會重新載入，先抓的會白費。
    if (Platform.OS === "web" && !webSsoCheckDue()) prefetchCommon(globalThis.location?.pathname ?? "/");
    (async () => {
      const raw = await AsyncStorage.getItem(CART_KEY).catch(() => null);
      if (raw) setCartState(JSON.parse(raw) as string[]);
      const demo = await loadToken();
      const hasCentral = !demo && (await hasCentralSession());
      let first = demo || hasCentral ? await fetchMember() : null;
      // 保存的短期憑證被伺服器拒絕（伺服器回「未登入」而不是錯誤）：用長期憑證換一張新的再問一次，不要讓使用者看起來被登出（2026-11-21）。
      if (hasCentral && first === null && (await refreshCentral())) first = await fetchMember();
      // 只有伺服器明確回覆「未登入」才清除；連線失敗時保留登入，下次再試。
      if (demo && first === null) await saveToken(null);
      let m = known(first);
      if (Platform.OS === "web" && !m?.demo) {
        // 共用登入：處理會員中心回傳，或（5 分鐘節流）詢問這個瀏覽器目前登入的會員。
        if (globalThis.location?.pathname === "/auth/sso") {
          const r = await handleWebSsoReturn(m?.sub ?? null);
          if (r.changed) m = known(await fetchMember());
          setSsoNext(r.next);
        } else if (!m && (await webSsoCheck())) return "redirecting";
        // 已經登入：不再每開一個分頁就跳去會員中心檢查（業主 2026-11-21：以前每次都整頁重新載入一次）。
        // 在會員中心登出所有裝置時，這裡的登入憑證會在下次換發時失效、自動變成未登入。
      }
      setMember(m);
    })().then((r) => r !== "redirecting" && setReady(true), () => setReady(true));
  }, []);

  const invalidate = useCallback(() => setVersion((v) => v + 1), []);
  const setCart = useCallback((ids: string[]) => {
    setCartState(ids);
    AsyncStorage.setItem(CART_KEY, JSON.stringify(ids)).catch(() => undefined);
  }, []);
  const lastFetch = useRef(Date.now());
  const reloadMember = useCallback(async () => {
    lastFetch.current = Date.now();
    setMember(known(await fetchMember()));
    invalidate();
  }, [invalidate]);
  const memberSub = member?.sub;
  setFeatureTrackSignedIn(!!memberSub);
  // 換帳號（登入、登出）時清掉讀取快取；開啟網站、登入檢查剛完成那一次不清（預先抓的資料已經帶著憑證）。
  const settledSub = useRef<{ sub: string | undefined } | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (settledSub.current && settledSub.current.sub !== memberSub) clearApiCache();
    settledSub.current = { sub: memberSub };
  }, [ready, memberSub]);
  const refreshMember = useCallback(
    async (minGapMs = 0) => {
      if (!memberSub || Date.now() - lastFetch.current < minGapMs) return;
      lastFetch.current = Date.now();
      const m = await fetchMember();
      if (m && m !== "offline" && m.sub === memberSub) {
        setMember(m);
        invalidate();
      }
    },
    [memberSub, invalidate],
  );
  // 回到 App／網頁（切回分頁、從背景回來）時，距離上次更新超過 10 分鐘才重新向伺服器（會員中心）拿一次最新的會員資料與獎銜；獎銜很少變動，不用頻繁詢問。
  // 開啟、重新整理一律立刻更新；App 沒有重新整理鈕，改用「下拉重新整理」（Screen）與「進入設定頁」（me.tsx）。
  // 管理員登入：記下「這是業主本人的裝置／網路」，之後的操作不列入使用統計（業主 2026-11-23）。
  const isAdminMember = member?.role === "admin";
  useEffect(() => {
    if (isAdminMember) markOwnerDevice();
  }, [isAdminMember, memberSub]);
  useEffect(() => {
    if (!memberSub) return;
    const sub = AppState.addEventListener("change", (st) => st === "active" && void refreshMember(10 * 60_000));
    const onVisible = () => globalThis.document?.visibilityState === "visible" && void refreshMember(10 * 60_000);
    globalThis.document?.addEventListener?.("visibilitychange", onVisible);
    return () => {
      sub.remove();
      globalThis.document?.removeEventListener?.("visibilitychange", onVisible);
    };
  }, [memberSub, refreshMember]);
  const signInGoogle = useCallback(async (returnTo = "/") => {
    await saveToken(null);
    const result = await signInWithGoogle(returnTo);
    if (result !== "ok") return;
    const m = known(await fetchMember());
    if (!m) throw Error("登入沒有成功，請再試一次");
    setMember(m);
    setCart([]);
    invalidate();
  }, [invalidate, setCart]);
  const signInDemo = useCallback(
    async (sub: string) => {
      await clearCentral();
      const r = await api<{ token: string; member: Member }>("POST", "/auth/demo", { sub });
      await saveToken(r.token);
      setMember(r.member);
      setCart([]);
      invalidate();
    },
    [invalidate, setCart],
  );
  const signOut = useCallback(async () => {
    if (member?.demo) await api("POST", "/auth/logout").catch(() => undefined);
    else {
      await signOutCentral(true); // 「登出所有 App」：中央會結束這位會員所有 App、所有裝置與會員中心網站的登入
      if (Platform.OS === "web") {
        await saveToken(null);
        webSsoLogout("/me"); // 登出這個瀏覽器的所有 App
        return;
      }
    }
    await saveToken(null);
    setMember(null);
    setCart([]);
    invalidate();
  }, [invalidate, setCart, member?.demo]);
  /** 刪除本 App 的學習資料並登出；中央會員帳號本身由「會員中心」的官方流程刪除。 */
  const deleteAccount = useCallback(async () => {
    await api("DELETE", "/me");
    if (!member?.demo) await signOutCentral();
    await saveToken(null);
    setMember(null);
    setCart([]);
    invalidate();
  }, [invalidate, setCart, member?.demo]);

  const deleteCentralAccount = useCallback(
    async (reauthToken: string) => {
      await api("POST", "/me/delete-account", { reauth_token: reauthToken }); // 伺服器：中央刪除成功才清本 App 資料；失敗會丟出中央的白話原因
      await clearCentral();
      await saveToken(null);
      setMember(null);
      setCart([]);
      clearApiCache();
      invalidate();
    },
    [invalidate, setCart],
  );

  const value = useMemo(
    () => ({ ready, member, signInGoogle, signInDemo, reloadMember, refreshMember, signOut, deleteAccount, deleteCentralAccount, version, invalidate, cart, setCart, ssoNext }),
    [ready, member, signInGoogle, signInDemo, reloadMember, refreshMember, signOut, deleteAccount, deleteCentralAccount, version, invalidate, cart, setCart, ssoNext],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw Error("useSession 必須在 SessionProvider 內使用");
  return s;
}

/** 讀取 API 資料：登入狀態改變、資料被異動、或畫面回到前景時自動重新抓取。 */
/** early：公開資料（公告等）不必等登入狀態載入完成，頁面一開就先抓。 */
export function useApi<T>(path: string | null, opts: { early?: boolean } = {}): { data: T | undefined; error: string | null; loading: boolean; reload: () => void } {
  const { version, member, ready } = useSession();
  const [data, setData] = useState<T | undefined>(() => (path ? peekCache<T>(path) : undefined));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !(path && peekCache(path) !== undefined));
  const seq = useRef(0);
  // 不再等登入檢查（/me）完成才抓資料：請求本來就會帶著登入憑證，伺服器自己判斷；登入狀態確定後只有「換了帳號」才重抓。
  const load = useCallback((fresh = false) => {
    if (!path) return;
    const id = ++seq.current;
    const hit = peekCache<T>(path);
    if (hit !== undefined) {
      setData(hit);
      setLoading(false);
    } else setLoading(true);
    // 開啟頁面時，10 秒內剛抓過（例如開機預先抓的）就直接用；重新整理、資料異動、回到前景一律重抓。
    cachedGet<T>(path, fresh ? 0 : 10_000)
      .then((d) => {
        if (id !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => id === seq.current && setError(e.message))
      .finally(() => id === seq.current && setLoading(false));
  }, [path]);
  const wasReady = useRef(ready);
  const loadedOnce = useRef(false);
  // member?.sub 與 version 變動時重新抓取；「登入檢查剛完成」那一刻不重抓（第一次請求已經帶著憑證）。
  // 會員中心太慢（2.5 秒還沒決定要不要跳轉）就不等了，照常抓資料。
  const [ssoGiveUp, setSsoGiveUp] = useState(false);
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => !loadedOnce.current && setSsoGiveUp(true), 2500);
    return () => clearTimeout(t);
  }, [ready]);
  useEffect(() => {
    // 這次開頁面會先整頁跳去會員中心做共用登入檢查：先不抓（跳回來會重新載入，現在抓的都白費，2026-11-21）。
    if (!ready && !ssoGiveUp && !loadedOnce.current && webSsoCheckDue()) return;
    if (!wasReady.current && ready && loadedOnce.current) {
      wasReady.current = true;
      return;
    }
    wasReady.current = ready;
    const first = !loadedOnce.current;
    loadedOnce.current = true;
    load(!first);
  }, [load, version, member?.sub, ready, ssoGiveUp]);
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) load(true);
      focused.current = true;
    }, [load]),
  );
  const reload = useCallback(() => load(true), [load]);
  void opts;
  // 沒有要抓的資料（path 為 null，例如訪客、沒有權限）＝不是「讀取中」，以免畫面一直轉圈（2026-11-21）。
  return { data, error, loading: !!path && (loading || (!ready && data === undefined)), reload };
}
