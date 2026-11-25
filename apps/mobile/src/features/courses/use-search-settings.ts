import { useMemo } from "react";
import { useApi } from "@/state/session";
import { setMemoryMinutes } from "@/lib/search-memory";
import { setSearchTune, type SearchTune } from "./course-search";

/** 搜尋參數（業主 2026-11-25，超級管理員在「設定 → 搜尋與 AI 設定」自訂）；讀不到就用預設（建議值）。 */
export type SearchSettings = SearchTune & { semanticEnabled: boolean; phoneticEnabled: boolean; searchMemoryMinutes: number; relatedEnabled: boolean; relatedBelow: number; relatedMax: number; relatedMinScore: number; gramScore2: number; gramScore3: number; gramScore4: number; gramCommonPct: number; looseEnabled: boolean; chaptersShuffle: boolean; showLocked: boolean };
const DEFAULTS: SearchSettings = { semanticEnabled: true, phoneticEnabled: true, fuzzyEnabled: true, fuzzyMaxDiff: 2, charsEnabled: true, charsMinLen: 3, listCardsLast: true, searchMemoryMinutes: 15, relatedEnabled: true, relatedBelow: 8, relatedMax: 30, relatedMinScore: 3, gramScore2: 3, gramScore3: 6, gramScore4: 10, gramCommonPct: 30, looseEnabled: true, chaptersShuffle: true, showLocked: true };

export function useSearchSettings(): SearchSettings {
  const { data } = useApi<Partial<SearchSettings>>("/search-settings", { early: true });
  const st = useMemo(() => ({ ...DEFAULTS, ...(data ?? {}) }) as SearchSettings, [data]);
  setSearchTune(st);
  setMemoryMinutes(st.searchMemoryMinutes); // 模糊、字元、排序的純函式讀這份
  return st;
}
