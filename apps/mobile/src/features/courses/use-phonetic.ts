import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { memoryTtl } from "@/lib/search-memory";

/**
 * 同音搜尋（杜杜龍 2026-11-24）：語音辨識常把「益之源」聽成「一支援」。完全比對沒有結果時，請伺服器用拼音（含近音）找同音的課程與章節編號。
 * 不用 AI、訪客也能用；停止打字 0.3 秒才送出，失敗回空集合。結果依相似程度由高到低（Set 保留順序）。
 */
const memo = new Map<string, { at: number; v: { q: string; courses: string[]; lessons: string[] } }>();
const recall = (q: string) => {
  const m = memo.get(q);
  return m && Date.now() - m.at < memoryTtl() ? m.v : null;
};
export function usePhonetic(q: string, enabled: boolean): { courses: string[]; lessons: string[]; loading: boolean } {
  const [res, setRes] = useState<{ q: string; courses: string[]; lessons: string[] } | null>(() => (q.trim() ? recall(q.trim()) : null));
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const text = q.trim();
  useEffect(() => {
    if (!enabled || text.length < 2) {
      setLoading(false);
      return;
    }
    const cached = recall(text);
    if (cached) {
      setRes(cached);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      api<{ courses: string[]; lessons: string[] }>("GET", `/search/phonetic?q=${encodeURIComponent(text)}`)
        .then((r) => {
          memo.set(text, { at: Date.now(), v: { q: text, ...r } });
          if (id === seq.current) setRes({ q: text, ...r });
        })
        .catch(() => id === seq.current && setRes({ q: text, courses: [], lessons: [] }))
        .finally(() => id === seq.current && setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [text, enabled]);
  const ok = enabled && res?.q === text;
  return { courses: ok ? res!.courses : [], lessons: ok ? res!.lessons : [], loading: enabled && loading };
}

export const clearPhoneticMemo = () => memo.clear();
