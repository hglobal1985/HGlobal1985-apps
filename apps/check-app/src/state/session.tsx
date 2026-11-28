/** 登入狀態、啟動檢查、資料讀取小工具。 */
import { useFocusEffect } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import type { Me } from "@check/contract";
import { api } from "@/api/client";
import { appConfig, currentMember, handleWebReturn, olderThan, onAuthChange, restore, restoreDev, ssoCheck, type AppStatus } from "@/central/auth";
import { APP_VERSION } from "@/central/config";
import { flash } from "@/kit";

type Gate = "ok" | "paused" | "killed" | "update";
type Session = {
  ready: boolean;
  signedIn: boolean;
  me: Me | null;
  gate: Gate;
  reloadMe: () => Promise<void>;
  deleted: boolean;
  /** 共用元件（下拉重新整理）用：目前登入的會員、重新讀會員資料、讓所有頁面重讀資料。 */
  member: Me | null;
  refreshMember: (maxAgeMs?: number) => Promise<void>;
  invalidate: () => void;
  version: number;
  /** 從中央登入回來後要去的頁面（/auth/done 處理完導回這裡）。 */
  returnTo: string | null;
};
const Ctx = createContext<Session>({ ready: false, signedIn: false, me: null, gate: "ok", reloadMe: async () => {}, deleted: false, member: null, refreshMember: async () => {}, invalidate: () => {}, version: 0, returnTo: null });
export const useSession = () => useContext(Ctx);

function gateOf(s: AppStatus | null): Gate {
  if (!s) return "ok";
  if (s.status === "killed") return "killed";
  if (s.status === "paused") return "paused";
  if (olderThan(APP_VERSION, s.min_version)) return "update";
  return "ok";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [gate, setGate] = useState<Gate>("ok");
  const [deleted] = useState(false);
  const [version, setVersion] = useState(0);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const invalidate = useCallback(() => setVersion((v) => v + 1), []);

  const reloadMe = useCallback(async () => {
    if (!currentMember()) {
      setMe(null);
      return;
    }
    try {
      setMe(await api<Me>("GET", "/me"));
    } catch {
      /* 稍後再試 */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setGate(gateOf(await appConfig()));
      let back: string | null = null;
      try {
        const r = await handleWebReturn();
        if (r?.back === "") return; // 正在導向中央（共用登入）
        back = r?.back ?? null;
      } catch (e) {
        flash((e as Error).message, undefined, true);
      }
      const ok = restoreDev() || (await restore());
      if (!alive) return;
      if (await ssoCheck()) return; // 網頁版導向中央詢問共用登入
      setSignedIn(ok || !!currentMember());
      if (back) setReturnTo(back);
      setReady(true);
    })();
    const off = onAuthChange(() => {
      setSignedIn(!!currentMember());
      void reloadMe();
    });
    const sub = AppState.addEventListener("change", async (s) => {
      if (s !== "active") return;
      setGate(gateOf(await appConfig()));
      if (Platform.OS !== "web") await ssoCheck();
    });
    return () => {
      alive = false;
      off();
      sub.remove();
    };
  }, [reloadMe]);

  useEffect(() => {
    if (signedIn) void reloadMe();
    else setMe(null);
  }, [signedIn, reloadMe]);

  return <Ctx.Provider value={{ ready, signedIn, me, gate, reloadMe, deleted, member: me, refreshMember: reloadMe, invalidate, version, returnTo }}>{children}</Ctx.Provider>;
}

/** 讀資料：進入畫面時讀取，回到畫面時自動重讀。 */
export function useData<T>(path: string | null): { data: T | null; error: string | null; loading: boolean; reload: () => Promise<void>; set: (d: T) => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { version } = useContext(Ctx);
  const pathRef = useRef(path);
  pathRef.current = path;
  const reload = useCallback(async () => {
    if (!pathRef.current) return;
    try {
      const d = await api<T>("GET", pathRef.current);
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload, path, version]),
  );
  return { data, error, loading, reload, set: setData };
}
