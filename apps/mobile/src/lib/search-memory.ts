import { useCallback, useState } from "react";

/**
 * 記住搜尋字（業主 2026-11-25）：點了某個搜尋結果、按返回時，要回到剛剛的搜尋結果，而不是空白的搜尋畫面。
 * 只放在記憶體（重新整理或超過 30 分鐘就忘記）；清除搜尋框時一併清掉。超派、至尊兩邊的搜尋共用。
 */
const mem = new Map<string, { q: string; at: number }>();
const TTL = 30 * 60_000;
export const recallQuery = (key: string): string => {
  const m = mem.get(key);
  return m && Date.now() - m.at < TTL ? m.q : "";
};
export function useRememberedQuery(key: string): [string, (v: string) => void] {
  const [q, set] = useState(() => recallQuery(key));
  const setQ = useCallback(
    (v: string) => {
      if (v.trim()) mem.set(key, { q: v, at: Date.now() });
      else mem.delete(key);
      set(v);
    },
    [key],
  );
  return [q, setQ];
}
