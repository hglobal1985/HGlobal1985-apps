import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { setCenterNames } from "@/features/format";
import { useApi, useSession } from "@/state/session";

type Names = { names: Record<string, string>; reload: () => void };
const Ctx = createContext<Names>({ names: {}, reload: () => undefined });

/**
 * 教育中心的自訂名稱（編輯中心頁可改）：登入後讀一次，存進 features/format.ts 的 centerTitle() 使用的對照表；
 * 名稱有變時，用 useCenterNames() 的元件會重新畫，整個行動大學的中心名稱就一起更新。
 */
export function CenterNamesProvider({ children }: { children: ReactNode }) {
  const { member } = useSession();
  const { data, reload } = useApi<Record<string, string>>(member ? "/center-names" : null);
  const names = data ?? {};
  setCenterNames(names); // 先設好再讓子元件算名稱（同一次畫面更新內就已生效）
  useEffect(() => () => setCenterNames({}), []);
  const value = useMemo(() => ({ names, reload }), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 讓元件在中心名稱更新時重新畫（呼叫 centerTitle() 的畫面請先呼叫這個）。 */
export const useCenterNames = () => useContext(Ctx);
