import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";

/**
 * 語意搜尋（業主 2026-11-23）：完全比對與模糊比對都找不到時，才請伺服器用 AI（BGE-M3 向量）找意思相近的課程與章節編號。
 * 停止打字 0.5 秒才送出；沒登入、額度用完或失敗時回空集合（不影響其他搜尋）。結果只有編號，畫面再依自己有權限的索引過濾。
 */
export type SemanticHit = { kind: string; tag: string; id: string; title: string; sub: string; link: string; score: number };
export function useSemantic(q: string, enabled: boolean): { courses: Set<string>; lessons: Set<string>; extras: SemanticHit[]; loading: boolean } {
  const [res, setRes] = useState<{ q: string; courses: string[]; lessons: string[]; extras: SemanticHit[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const text = q.trim();
  useEffect(() => {
    if (!enabled || text.length < 2) {
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      api<{ courses: string[]; lessons: string[]; extras?: SemanticHit[] }>("GET", `/search/semantic?q=${encodeURIComponent(text)}`)
        .then((r) => id === seq.current && setRes({ q: text, ...r, extras: r.extras ?? [] }))
        .catch(() => id === seq.current && setRes({ q: text, courses: [], lessons: [], extras: [] }))
        .finally(() => id === seq.current && setLoading(false));
    }, 500);
    return () => clearTimeout(t);
  }, [text, enabled]);
  const ok = enabled && res?.q === text;
  return { courses: new Set(ok ? res!.courses : []), lessons: new Set(ok ? res!.lessons : []), extras: ok ? res!.extras : [], loading: enabled && loading };
}
