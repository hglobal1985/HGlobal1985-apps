import { useCallback, useState } from "react";

/**
 * 記住搜尋字（業主 2026-11-25）：點了某個搜尋結果、按返回時，要回到剛剛的搜尋結果，而不是空白的搜尋畫面。
 * 只放在記憶體（重新整理或超過 設定的時間（預設 15 分鐘，「搜尋與 AI 設定」可改）就忘記）；清除搜尋框時一併清掉。超派、至尊兩邊的搜尋共用。
 */
const mem = new Map<string, { q: string; at: number }>();
let ttl = 15 * 60_000;
/** 後台「搜尋記憶」分鐘數（設定頁自訂，預設 15）；搜尋字與搜尋結果快取共用。 */
export const setMemoryMinutes = (m: number) => { if (m >= 1) ttl = m * 60_000; };
export const memoryTtl = () => ttl;
export const recallQuery = (key: string): string => {
  const m = mem.get(key);
  return m && Date.now() - m.at < ttl ? m.q : "";
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

/**
 * 從搜尋結果點進去（業主 2026-11-25）：按返回要回到「點結果的那一頁」（首頁搜尋結果），而不是被頁面的 backTo 導去課程頁。
 * 點結果時呼叫 markFromSearch；TopBar 的返回用 consumeFromSearch 判斷（有效時間同搜尋記憶）。
 */
let fromSearchAt = 0;
export const markFromSearch = () => {
  fromSearchAt = Date.now();
};
export const consumeFromSearch = (): boolean => {
  const ok = fromSearchAt > 0 && Date.now() - fromSearchAt < ttl;
  fromSearchAt = 0;
  return ok;
};
