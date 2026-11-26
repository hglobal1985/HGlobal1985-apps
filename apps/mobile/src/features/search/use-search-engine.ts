import { useMemo, useState } from "react";
import { useApi, useSession } from "@/state/session";
import type { CourseSummary } from "@/api/client";
import type { ChapterItem } from "@/features/courses/chapter-list";
import { buildSearchIndex, charsCourses, fuzzyCourses, fuzzyLessons, looseLessons, matchCourses, matchLessons, rankCourses, type SearchLesson } from "@/features/courses/course-search";
import { useSearchSettings } from "@/features/courses/use-search-settings";
import { usePhonetic } from "@/features/courses/use-phonetic";
import { useSemantic } from "@/features/courses/use-semantic";
import { useSynonyms } from "@/features/courses/use-synonyms";

/** 搜尋找得到的課程：上架中、不是「只限網址」（清單卡也列）。超派、至尊共用同一條件。 */
export const listable = (x: CourseSummary) => x.status === "published" && x.viewScope !== "link_login" && x.viewScope !== "link_guest";

/**
 * 全站唯一的搜尋引擎（杜杜龍 2026-11-25：同樣的關鍵字，超派與至尊結果完全不同 → 重新串成同一個模組）。
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
  const gram = { w2: searchSt.gramScore2, w3: searchSt.gramScore3, w4: searchSt.gramScore4, commonPct: searchSt.gramCommonPct };
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
  // 主結果＝「單元」（章節）清單（杜杜龍 2026-11-25：以超派原本的搜尋結果為正確，至尊要跟它一樣；超派原本搜尋一律是單元模式）：
  // 有字面符合的章節就只列它們；沒有才合併 模糊＋語意（AI）＋同音 找到的章節。順序＝每次打開頁面洗牌一次（同一次瀏覽相對順序不變）。
  const { member } = useSession();
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const chapters = useMemo<ChapterItem[]>(() => {
    if (!key) return [];
    const exactL = matchLessons(index, key);
    let hit: Set<string>;
    let loose: string[] = [];
    if (exactL && exactL.size) hit = new Set(exactL);
    else {
      hit = new Set<string>();
      if (!semOnly) for (const id of fuzzyLessons(index, key)) hit.add(id);
      for (const id of semantic.lessons) if (index.lessonHay.has(id)) hit.add(id);
      for (const id of phonetic.lessons) if (index.lessonHay.has(id)) hit.add(id);
      // 都找不到時（等 AI、同音找完之後）：退到「最相近的單元」，搜尋結果不留空白（杜杜龍 2026-11-25）。
      if (!hit.size && searchSt.looseEnabled && idx.data && !semantic.loading && !phonetic.loading) {
        loose = looseLessons(index, key, searchSt.relatedMax, 1, gram);
        for (const id of loose) hit.add(id);
      }
    }
    // 字面符合太少（不到 8 個）時，補上「至少有兩個相鄰兩字片段命中」的單元排在後面（杜杜龍 2026-11-25：搜「晚安修護面膜」只有 1 個單元、關聯結果太少）。
    const extraRel: string[] = exactL && exactL.size && searchSt.relatedEnabled && exactL.size < searchSt.relatedBelow ? looseLessons(index, key, searchSt.relatedMax, searchSt.relatedMinScore, gram).filter((id) => !exactL.has(id)) : [];
    for (const id of extraRel) hit.add(id);
    const byId = new Map(all.map((x) => [x.id, x]));
    const canWatch = (x: CourseSummary) => (member?.role === "admin" && x.isList) || x.enrollment === "opened" || (x.isPublic && x.isList) || x.watchFree;
    const rand = (id: string) => {
      if (!searchSt.chaptersShuffle) return 0;
      let h = seed | 0;
      for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 2654435761);
      return (h ^ (h >>> 15)) >>> 0;
    };
    const out: ChapterItem[] = [];
    for (const l of idx.data?.lessons ?? []) {
      const co = byId.get(l.courseId);
      if (co && hit.has(l.id) && (searchSt.showLocked || canWatch(co))) out.push({ lesson: l, course: co, locked: !canWatch(co) });
    }
    // 字面符合＝洗牌（跟超派原本的單元模式一樣）；「相近」找到的依相關度排：同音（覆蓋越多越前面）> AI 語意。
    if (!(exactL && exactL.size)) {
      const rank = new Map<string, number>();
      [...phonetic.lessons].forEach((id, i) => rank.set(id, i));
      [...semantic.lessons].forEach((id, i) => !rank.has(id) && rank.set(id, 1000 + i));
      loose.forEach((id, i) => !rank.has(id) && rank.set(id, 2000 + i)); // 最相近：命中片段多的在前
      return out.sort((a, b) => (rank.get(a.lesson.id) ?? 5000) - (rank.get(b.lesson.id) ?? 5000) || rand(a.lesson.id) - rand(b.lesson.id));
    }
    if (extraRel.length) {
      const order = new Map(extraRel.map((id, i) => [id, i + 1]));
      return out.sort((a, b) => (order.get(a.lesson.id) ?? 0) - (order.get(b.lesson.id) ?? 0) || rand(a.lesson.id) - rand(b.lesson.id));
    }
    return out.sort((a, b) => rand(a.lesson.id) - rand(b.lesson.id));
  }, [key, index, all, idx.data, semOnly, semantic.lessons, semantic.loading, phonetic.lessons, phonetic.loading, member, seed, searchSt]);
  // 其他類別命中裡的「單一教材」已經在單元清單裡，不重複列。
  const extras = useMemo(() => semantic.extras.filter((h) => h.kind !== "lesson"), [semantic.extras]);
  return { key, searching: !!key, all, index, results, semantic, phonetic, chapters, extras, coursePrio: semantic.coursePrio, loading: semantic.loading || phonetic.loading };
}
