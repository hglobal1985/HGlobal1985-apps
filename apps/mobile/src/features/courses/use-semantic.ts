import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { memoryTtl } from "@/lib/search-memory";

/**
 * 語意搜尋（業主 2026-11-23）：完全比對與模糊比對都找不到時，才請伺服器用 AI（BGE-M3 向量）找意思相近的課程與章節編號。
 * 停止打字 0.5 秒才送出；沒登入、額度用完或失敗時回空集合（不影響其他搜尋）。結果只有編號，畫面再依自己有權限的索引過濾。
 */
export type SemanticHit = { kind: string; tag: string; id: string; title: string; sub: string; link: string; score: number; prio?: number; /** 左邊縮圖網址（沒有＝預設圖）。 */ thumb?: string | null; /** 有＝點了直接放大看這張圖（EDM、相片）。 */ image?: string; /** 沒有權限：標鎖頭，點了顯示原因（業主 2026-11-25）。 */ locked?: boolean; lockLines?: string[] };
/** 同一個查詢的結果記在記憶體（設定的時間（預設 15 分鐘））：從搜尋結果點進去再按返回時，不必重新等一次（業主 2026-11-25：返回會空白停頓一秒）。 */
const memo = new Map<string, { at: number; v: { q: string; courses: string[]; lessons: string[]; extras: SemanticHit[]; coursePrio: number } }>();
const recall = (q: string) => {
  const m = memo.get(q);
  return m && Date.now() - m.at < memoryTtl() ? m.v : null;
};
export function useSemantic(q: string, enabled: boolean): { courses: Set<string>; lessons: Set<string>; extras: SemanticHit[]; coursePrio: number; loading: boolean } {
  const [res, setRes] = useState<{ q: string; courses: string[]; lessons: string[]; extras: SemanticHit[]; coursePrio: number } | null>(() => (q.trim() ? recall(q.trim()) : null));
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
      api<{ courses: string[]; lessons: string[]; extras?: SemanticHit[]; coursePrio?: number }>("GET", `/search/semantic?q=${encodeURIComponent(text)}`)
        .then((r) => {
          const v = { q: text, ...r, extras: r.extras ?? [], coursePrio: r.coursePrio ?? 9 };
          memo.set(text, { at: Date.now(), v });
          if (id === seq.current) setRes(v);
        })
        .catch(() => id === seq.current && setRes({ q: text, courses: [], lessons: [], extras: [], coursePrio: 9 }))
        .finally(() => id === seq.current && setLoading(false));
    }, 500);
    return () => clearTimeout(t);
  }, [text, enabled]);
  const ok = enabled && res?.q === text;
  return { courses: new Set(ok ? res!.courses : []), lessons: new Set(ok ? res!.lessons : []), extras: ok ? res!.extras : [], coursePrio: ok ? res!.coursePrio : 9, loading: enabled && (loading || (text.length >= 2 && res?.q !== text)) };
}

/** 後台改了搜尋設定後，清掉記住的結果，立刻用新設定（業主 2026-11-25）。 */
export const clearSemanticMemo = () => memo.clear();
