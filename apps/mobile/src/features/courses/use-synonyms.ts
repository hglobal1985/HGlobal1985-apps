import { useApi } from "@/state/session";

/** 自訂關聯詞（設定 › 搜尋關聯詞，業主 2026-11-25）：每組是一串意思相同的詞。超派、至尊搜尋共用。 */
export function useSynonyms(): string[][] {
  const r = useApi<{ groups: string[][] }>("/search-synonyms");
  return r.data?.groups ?? [];
}
