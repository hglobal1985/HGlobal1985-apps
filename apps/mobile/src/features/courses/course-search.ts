import type { CourseSummary } from "@/api/client";

/** 搜尋索引（後端 GET /search-index）裡每一堂章節的資料。 */
export type SearchLesson = { id: string; courseId: string; position: number; title: string; sharer: string; sharerRankName: string; sharerTitle: string; eventDate: string | null; /** 主講人章節（每門課最多一堂）。 */ isSpeaker?: boolean; /** 總結與銷售課程（每門課最多一堂，與主講人互斥）。 */ isSummary?: boolean; /** 所屬課程是「短影音專輯」。 */ isShorts?: boolean; /** 其他教材（只有短影音專輯的影音教材會出現在索引）。 */ isMaterial?: boolean; minutes: number; ready: boolean; completed: boolean; /** 章節自己的橫式封面（沒設定為 null＝用課程封面）。 */ coverUrl: string | null; };
/** 關聯詞（輸入時列出的建議）：種類＋文字。 */
export type SearchTerm = { kind: "系列" | "課程" | "主講人" | "獎銜" | "職稱" | "章節" | "日期"; text: string };
export type SearchIndex = { haystack: Map<string, string>; /** 章節模式用：每一堂自己的搜尋文字（含所屬課程的主講人、系列、日期）。 */ lessonHay: Map<string, string>; terms: SearchTerm[] };

/** 2026-11-03 → 各種常見寫法，使用者打「11/3」「2026/11」「11月3日」都找得到。 */
export function dateForms(d: string | null | undefined): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? "");
  if (!m) return [];
  const [y, mo, da] = [m[1]!, m[2]!, m[3]!];
  const [n, dn] = [String(Number(mo)), String(Number(da))];
  return [`${y}/${n}/${dn}`, `${y}/${mo}/${da}`, `${y}-${mo}-${da}`, `${n}/${dn}`, `${mo}/${da}`, `${y}年${n}月${dn}日`, `${n}月${dn}日`, `${y}${mo}${da}`];
}

/**
 * 搜尋範圍：主講人（姓名、獎銜、職稱）、系列、課程名稱、章節標題、分享者、日期（課程日期與每一堂的日期）。
 * 每門課產生一串小寫文字，之後輸入的字只要被包含就算符合。
 */
export function buildSearchIndex(courses: CourseSummary[], lessons: SearchLesson[]): SearchIndex {
  const byCourse = new Map<string, SearchLesson[]>();
  for (const l of lessons) byCourse.set(l.courseId, [...(byCourse.get(l.courseId) ?? []), l]);
  const terms = new Map<string, SearchTerm>();
  const add = (kind: SearchTerm["kind"], text: string | null | undefined) => {
    const t = (text ?? "").trim();
    if (t) terms.set(`${kind}:${t}`, { kind, text: t });
  };
  const haystack = new Map<string, string>();
  const lessonHay = new Map<string, string>();
  for (const c of courses) {
    const parts: string[] = [c.title, c.series, c.teacher, c.teacherRankName, c.teacherTitle];
    const courseParts: string[] = [...parts];
    add("課程", c.title);
    add("系列", c.series);
    add("主講人", c.teacher);
    add("獎銜", c.teacherRankName);
    add("職稱", c.teacherTitle);
    for (const d of [c.eventStart, c.eventEnd]) {
      parts.push(...dateForms(d));
      courseParts.push(...dateForms(d));
      if (d) add("日期", dateForms(d)[0]);
    }
    for (const l of byCourse.get(c.id) ?? []) {
      parts.push(l.title, l.sharer, l.sharerRankName, l.sharerTitle, ...dateForms(l.eventDate));
      lessonHay.set(l.id, [...courseParts, l.title, l.sharer, l.sharerRankName, l.sharerTitle, ...dateForms(l.eventDate)].filter(Boolean).join("\u0001").toLowerCase());
      add("章節", l.title);
      add("主講人", l.sharer);
      add("獎銜", l.sharerRankName);
      add("職稱", l.sharerTitle);
      if (l.eventDate) add("日期", dateForms(l.eventDate)[0]);
    }
    haystack.set(c.id, parts.filter(Boolean).join("\u0001").toLowerCase());
  }
  return { haystack, lessonHay, terms: [...terms.values()] };
}

const tokens = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

/** 符合的課程編號（空白搜尋＝null，代表不過濾）。多個詞用空白隔開時，每個詞都要符合。 */
export function matchCourses(index: SearchIndex, q: string): Set<string> | null {
  const t = tokens(q);
  if (!t.length) return null;
  const out = new Set<string>();
  for (const [id, hay] of index.haystack) if (t.every((w) => hay.includes(w))) out.add(id);
  return out;
}

/** 章節模式：符合的章節編號（空白搜尋＝null）。 */
export function matchLessons(index: SearchIndex, q: string): Set<string> | null {
  const t = tokens(q);
  if (!t.length) return null;
  const out = new Set<string>();
  for (const [id, hay] of index.lessonHay) if (t.every((w) => hay.includes(w))) out.add(id);
  return out;
}

/** 關聯詞：包含輸入文字的詞（最後一個詞為準），開頭相同的排前面；最多 limit 個。 */
export function suggestTerms(index: SearchIndex, q: string, limit = 8): SearchTerm[] {
  const last = tokens(q).at(-1);
  if (!last) return [];
  const hit = index.terms.filter((t) => t.text.toLowerCase().includes(last));
  hit.sort((a, b) => Number(b.text.toLowerCase().startsWith(last)) - Number(a.text.toLowerCase().startsWith(last)) || a.text.length - b.text.length);
  return hit.slice(0, limit);
}

/**
 * 模糊比對（業主 2026-11-23，容錯打錯字）：在一段文字裡找「最多差 k 個字」的相似片段（Sellers 近似子字串比對）。
 * 差 k 個字＝漏字、多字、錯字都算；例：「益支源」找得到「益之源」。
 */
export function approxIncludes(text: string, pat: string, k: number): boolean {
  const p = [...pat];
  const m = p.length;
  if (!m) return true;
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  for (const ch of text) {
    const cur = [0];
    for (let i = 1; i <= m; i++) cur[i] = Math.min(prev[i]! + 1, cur[i - 1]! + 1, prev[i - 1]! + (p[i - 1] === ch ? 0 : 1));
    if (cur[m]! <= k) return true;
    prev = cur;
  }
  return false;
}
/** 容許的差異字數：1～2 個字必須完全一樣（太短會亂配）、3～4 個字差 1、5 個字以上差 2。 */
const allowance = (len: number) => (len <= 2 ? 0 : len <= 4 ? 1 : 2);
const fuzzyHit = (hay: string, w: string) => {
  if (hay.includes(w)) return true;
  const k = allowance([...w].length);
  return k > 0 && hay.split("\u0001").some((f) => f && approxIncludes(f, w, k));
};
/** 模糊比對的課程編號（空白搜尋＝null）。只在完全比對沒有結果時才用。 */
export function fuzzyCourses(index: SearchIndex, q: string): Set<string> {
  const t = tokens(q);
  const out = new Set<string>();
  if (t.length) for (const [id, hay] of index.haystack) if (t.every((w) => fuzzyHit(hay, w))) out.add(id);
  return out;
}
/** 章節模式的模糊比對。 */
export function fuzzyLessons(index: SearchIndex, q: string): Set<string> {
  const t = tokens(q);
  const out = new Set<string>();
  if (t.length) for (const [id, hay] of index.lessonHay) if (t.every((w) => fuzzyHit(hay, w))) out.add(id);
  return out;
}
