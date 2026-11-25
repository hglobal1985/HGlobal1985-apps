import type { CourseSummary } from "@/api/client";

/** 搜尋索引（後端 GET /search-index）裡每一堂章節的資料。 */
export type SearchLesson = { id: string; courseId: string; position: number; title: string; sharer: string; sharerRankName: string; sharerTitle: string; eventDate: string | null; /** 主講人章節（每門課最多一堂）。 */ isSpeaker?: boolean; /** 總結與銷售課程（每門課最多一堂，與主講人互斥）。 */ isSummary?: boolean; /** 所屬課程是「短影音專輯」。 */ isShorts?: boolean; /** 其他教材（只有短影音專輯的影音教材會出現在索引）。 */ isMaterial?: boolean; minutes: number; ready: boolean; completed: boolean; /** 章節自己的橫式封面（沒設定為 null＝用課程封面）。 */ coverUrl: string | null; };
/** 關聯詞（輸入時列出的建議）：種類＋文字。 */
export type SearchTerm = { kind: "系列" | "課程" | "主講人" | "獎銜" | "職稱" | "章節" | "日期"; text: string };
export type SearchIndex = { haystack: Map<string, string>; /** 章節模式用：每一堂自己的搜尋文字（含所屬課程的主講人、系列、日期）。 */ lessonHay: Map<string, string>; terms: SearchTerm[] };

/**
 * 自訂關聯詞（業主 2026-11-25）：課程文字裡只要有某一組的任何一個詞，這組的其他詞也加進這門課的搜尋文字（各自獨立一段，
 * 所以「王儷凱」打錯字也能用模糊比對找到「王老師」的課）。回傳一個把文字補上關聯詞的函式。
 */
export function withSynonyms(groups: string[][]): (hay: string) => string {
  const gs = groups.map((g) => g.map((t) => t.toLowerCase()).filter(Boolean)).filter((g) => g.length >= 2);
  if (!gs.length) return (hay) => hay;
  return (hay) => {
    let out = hay;
    for (const g of gs) if (g.some((t) => hay.includes(t))) for (const t of g) if (!out.includes(t)) out += `\u0001${t}`;
    return out;
  };
}

/** 查詢的詞若屬於某組關聯詞，語意搜尋（AI）一起送出同組的其他詞，找得更廣。 */
export function expandQuery(groups: string[][], q: string): string {
  const k = q.trim().toLowerCase();
  if (!k) return q;
  const extra = new Set<string>();
  for (const g of groups) if (g.some((t) => t.toLowerCase() === k)) for (const t of g) if (t.toLowerCase() !== k) extra.add(t);
  return extra.size ? `${q.trim()} ${[...extra].join(" ")}` : q;
}

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
export function buildSearchIndex(courses: CourseSummary[], lessons: SearchLesson[], synonyms: string[][] = []): SearchIndex {
  const syn = withSynonyms(synonyms);
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
    // 搜尋範圍也含「主辦中心、主辦／指導單位、分類、品牌」與「EDM」關鍵字（有 EDM 海報的課程；業主 2026-11-24：搜「新竹 EDM」不可沒有結果）。
    const parts: string[] = [c.title, c.series, c.teacher, c.teacherRankName, c.teacherTitle, c.hostCenter, c.hostUnit, c.guidanceUnit, c.category, c.brandName ?? "", c.edmUrl ? "EDM 海報" : ""];
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
      lessonHay.set(l.id, syn([...courseParts, l.title, l.sharer, l.sharerRankName, l.sharerTitle, ...dateForms(l.eventDate)].filter(Boolean).join("\u0001").toLowerCase()));
      add("章節", l.title);
      add("主講人", l.sharer);
      add("獎銜", l.sharerRankName);
      add("職稱", l.sharerTitle);
      if (l.eventDate) add("日期", dateForms(l.eventDate)[0]);
    }
    haystack.set(c.id, syn(parts.filter(Boolean).join("\u0001").toLowerCase()));
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
/** 搜尋參數（由「搜尋與 AI 設定」決定；use-search-settings.ts 每次繪製前更新）。 */
export type SearchTune = { fuzzyEnabled: boolean; fuzzyMaxDiff: number; charsEnabled: boolean; charsMinLen: number; listCardsLast: boolean };
let TUNE: SearchTune = { fuzzyEnabled: true, fuzzyMaxDiff: 2, charsEnabled: true, charsMinLen: 3, listCardsLast: true };
export const setSearchTune = (t: SearchTune) => { TUNE = t; };
/** 容許的差異字數：1～2 個字必須完全一樣（太短會亂配）、3～4 個字差 1、5 個字以上差 2。 */
const allowance = (len: number) => Math.min(TUNE.fuzzyEnabled ? TUNE.fuzzyMaxDiff : 0, len <= 2 ? 0 : len <= 4 ? 1 : 2);
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

/**
 * 字元比對（業主 2026-11-24：語音輸入「線上白金」要找得到「安麗與白金線上溝通會」）：
 * 查詢的每個字（不分順序）都出現在同一門課的文字裡就算符合；至少 3 個字才用，避免太短亂配。
 * 只在完全比對與模糊比對都沒結果時才用，且不需要 AI，額度用完也找得到。
 */
export function charsCourses(index: SearchIndex, q: string): Set<string> {
  const chars = [...new Set([...q.toLowerCase().replace(/\s+/g, "")])];
  const out = new Set<string>();
  if (!TUNE.charsEnabled || chars.length < TUNE.charsMinLen) return out;
  for (const [id, hay] of index.haystack) if (chars.every((ch) => hay.includes(ch))) out.add(id);
  return out;
}

/**
 * 搜尋結果排序（業主 2026-11-24）：關聯性高 > 日期最新 > 已報名；至尊、超派共用這一個。
 * 關聯性：課程名稱完全包含（名稱就是查詢字最高）＞主講人／系列／獎銜包含＞章節或日期包含＞同音＞模糊＞字元比對＞AI 語意（依伺服器給的相似度順序）。
 * near.phonetic／near.semantic 是伺服器依相似度排好的課程編號。
 */
export function rankCourses(index: SearchIndex, list: CourseSummary[], q: string, near: { phonetic?: string[]; semantic?: string[]; fuzzy?: Set<string>; chars?: Set<string> } = {}): CourseSummary[] {
  const t = tokens(q);
  // 同一堂課可能先以「課程名稱」再以「章節」命中：只留第一次（名稱命中在前、分數較高），後面重複的不能把分數蓋低。
  const uniq = (a: string[] = []) => [...new Set(a)];
  const phon = new Map(uniq(near.phonetic).map((id, i, a) => [id, 2.9 - (i / Math.max(1, a.length)) * 0.4]));
  const sem = new Map(uniq(near.semantic).map((id, i, a) => [id, 1 - (i / Math.max(1, a.length)) * 0.4]));
  const rel = (c: CourseSummary): number => {
    const hay = index.haystack.get(c.id) ?? "";
    const parts = hay.split("\u0001");
    if (t.length && t.every((w) => parts[0]!.includes(w))) return parts[0] === q.trim().toLowerCase() ? 6 : 5;
    if (t.length && t.every((w) => parts.slice(0, 5).some((p) => p.includes(w)))) return 4;
    if (t.length && t.every((w) => hay.includes(w))) return 3;
    return Math.max(phon.get(c.id) ?? 0, near.fuzzy?.has(c.id) ? 2 : 0, near.chars?.has(c.id) ? 1.5 : 0, sem.get(c.id) ?? 0);
  };
  const date = (c: CourseSummary) => c.eventStart || c.createdAt || "";
  const enrolled = (c: CourseSummary) => (c.enrollment === "opened" ? 2 : c.enrollment === "pending" ? 1 : 0);
  return list
    .map((c) => ({ c, r: rel(c) }))
    // 只是「相近」（同音、模糊、AI 語意）的品牌／清單卡排在課程後面（業主 2026-11-25）；字面完全符合的不受影響。
    .sort((a, b) => (TUNE.listCardsLast ? Number(a.c.isList && a.r < 3) - Number(b.c.isList && b.r < 3) : 0) || b.r - a.r || (date(b.c) > date(a.c) ? 1 : date(b.c) < date(a.c) ? -1 : 0) || enrolled(b.c) - enrolled(a.c))
    .map((x) => x.c);
}
