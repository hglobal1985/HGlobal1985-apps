import { useMemo } from "react";
import { useApi } from "@/state/session";
import type { CourseSummary } from "@/api/client";
import { buildSearchIndex, charsCourses, fuzzyCourses, matchCourses, rankCourses, type SearchLesson } from "@/features/courses/course-search";
import { useSearchSettings } from "@/features/courses/use-search-settings";
import { usePhonetic } from "@/features/courses/use-phonetic";
import { useSemantic } from "@/features/courses/use-semantic";
import { useSynonyms } from "@/features/courses/use-synonyms";

/** 搜尋找得到的課程：上架中、不是「只限網址」（清單卡也列）。超派、至尊共用同一條件。 */
export const listable = (x: CourseSummary) => x.status === "published" && x.viewScope !== "link_login" && x.viewScope !== "link_guest";

/**
 * 全站唯一的搜尋引擎（業主 2026-11-25：同樣的關鍵字，超派與至尊結果完全不同 → 重新串成同一個模組）。
 * 超派（courses-view）與至尊（elder-search）都只呼叫這一個：同樣的候選課程、同樣的標點整理、同樣的找法與排序、同樣的後台設定。
 * 之後要改找法、條件、排序，只改這裡（與後台「搜尋與 AI 設定」「試搜尋」）；兩個畫面只負責把結果畫出來。
 *
 * 規則：①語意搜尋（AI，查詢字原樣送出）開著而且有結果（或還在找）→ 只顯示它的結果，字面、模糊、字元比對都不混入；
 * ②同音搜尋永遠並存（語音辨識錯字救星，「一支援」找得到「益之源」）；③語意沒結果才退回字面、模糊、字元比對；
 * ④排序＝`rankCourses`（關聯性 > 日期最新 > 已報名）；⑤語意搜尋的其他類別命中（單一教材、系列、中心、EDM、相片…）在 `extras`。
 */
export function useSearchEngine(q: string, courses: CourseSummary[]) {
  // 語音辨識有時會在句中加標點（「線上，白金」）：比對前一律換成空白。
  const key = useMemo(() => q.replace(/[。．.！!？?，,、；;：:「」“”"'（）()]+/g, " ").trim(), [q]);
  const all = useMemo(() => courses.filter(listable), [courses]);
  const idx = useApi<{ lessons: SearchLesson[] }>(key ? "/search-index" : null);
  const synonyms = useSynonyms();
  const index = useMemo(() => buildSearchIndex(all, idx.data?.lessons ?? [], synonyms), [all, idx.data, synonyms]);
  const searchSt = useSearchSettings();
  const exactRaw = useMemo(() => (key ? matchCourses(index, key) : null), [index, key]);
  const semantic = useSemantic(key, searchSt.semanticEnabled);
  const semOnly = searchSt.semanticEnabled && !!key && (semantic.loading || semantic.courses.size > 0 || semantic.extras.length > 0);
  const exact = semOnly && exactRaw ? new Set<string>() : exactRaw;
  const noExact = !!exact && exact.size === 0;
  const phonetic = usePhonetic(key, (noExact || semOnly) && searchSt.phoneticEnabled);
  const results = useMemo(() => {
    if (!key) return [];
    const byLesson = new Map((idx.data?.lessons ?? []).map((l) => [l.id, l.courseId]));
    const lessonCourses = (ids: Iterable<string>) => [...ids].map((lid) => byLesson.get(lid)).filter((x): x is string => !!x && index.haystack.has(x));
    let ids: Set<string> = exact ?? new Set();
    let near: Parameters<typeof rankCourses>[3] = {};
    if (!ids.size) {
      const fuzzy = semOnly ? new Set<string>() : fuzzyCourses(index, key);
      const chars = semOnly ? new Set<string>() : charsCourses(index, key);
      const phon = [...phonetic.courses, ...lessonCourses(phonetic.lessons)].filter((id) => index.haystack.has(id));
      const sem = [...semantic.courses].filter((id) => index.haystack.has(id));
      ids = new Set([...fuzzy, ...chars, ...phon, ...sem]);
      near = { phonetic: phon, semantic: sem, fuzzy, chars };
    }
    return rankCourses(index, all.filter((x) => ids.has(x.id)), key, near);
  }, [key, index, all, exact, semantic.courses, semantic.lessons, semOnly, phonetic.courses, phonetic.lessons, idx.data, searchSt]);
  return { key, searching: !!key, all, index, results, semantic, phonetic, extras: semantic.extras, coursePrio: semantic.coursePrio, loading: semantic.loading || phonetic.loading };
}
