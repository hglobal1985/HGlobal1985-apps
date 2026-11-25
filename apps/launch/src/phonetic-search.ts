/**
 * 同音搜尋（業主 2026-11-24：語音辨識常把「益之源」聽成「一支援」，要找得到同音、近音的錯字）：
 * 把查詢文字與課程名稱、系列、主講人、章節標題都轉成拼音（不含聲調），並把台灣常見的近音（zh/z、ch/c、sh/s、
 * 後鼻音 ng/n、ü/u）視為相同，再比對「連續幾個音節相同」。不用 AI、不花額度，訪客也能用。
 * 只回課程與章節編號（依相似程度排序）；前端只顯示自己有權限的索引裡有的，所以不洩漏內容。
 */
import { pinyin } from "pinyin-pro";
import { loadSearchSettings } from "./search-settings.ts";
import type { D1Database } from "./d1.ts";

/** 近音正規化：翹舌＝平舌、前後鼻音相同、ü＝u。 */
export function normSyllable(s: string): string {
  return s.replace(/[üv]/g, "u").replace(/^(zh|ch|sh)/, (m) => m[0]!).replace(/(an|en|in)g$/, "$1").replace(/^(a|e)ng$/, "$1n");
}

/** 文字 → 近音音節陣列（中文轉拼音，英數字詞整段當一個音節；標點與空白略過）。 */
export function syllables(text: string): string[] {
  const out: string[] = [];
  for (const t of pinyin(text.slice(0, 200), { toneType: "none", type: "array", nonZh: "consecutive", v: true })) {
    const w = t.trim().toLowerCase();
    if (!w || !/[a-z0-9ü]/.test(w)) continue;
    out.push(/^[a-zü]+$/.test(w) && w.length <= 6 ? normSyllable(w) : w);
  }
  return out;
}

/** 音節陣列 q 在 s 裡「最多差 k 個音節」出現（Sellers 近似子序列）。 */
export function approxSyl(s: string[], q: string[], k: number): boolean {
  const m = q.length;
  if (!m) return false;
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  for (const ch of s) {
    const cur = [0];
    for (let i = 1; i <= m; i++) cur[i] = Math.min(prev[i]! + 1, cur[i - 1]! + 1, prev[i - 1]! + (q[i - 1] === ch ? 0 : 1));
    if (cur[m]! <= k) return true;
    prev = cur;
  }
  return false;
}
/** 容許差幾個音節：2～3 音節必須完全相同，4 個以上可差 1。 */
const allow = (m: number, from = 4) => (m >= from ? 1 : 0);

type Seg = { syl: string[]; w: number };
type Entry = { kind: "course" | "lesson"; id: string; courseId: string; segs: Seg[] };
let cache: { at: number; rows: Entry[] } | null = null;

async function load(db: D1Database): Promise<Entry[]> {
  if (cache && Date.now() - cache.at < 600_000) return cache.rows;
  const [c, l] = await Promise.all([
    db.prepare("SELECT id, title, series, teacher FROM courses WHERE status = 'published'").all<{ id: string; title: string; series: string | null; teacher: string | null }>(),
    db.prepare("SELECT l.id AS id, l.course_id AS course_id, l.title AS title, c.title AS ct, c.series AS cs FROM lessons l JOIN courses c ON c.id = l.course_id WHERE c.status = 'published' AND l.title <> ''").all<{ id: string; course_id: string; title: string; ct: string; cs: string | null }>(),
  ]);
  const rows: Entry[] = [
    ...c.results.map((r): Entry => ({ kind: "course", id: r.id, courseId: r.id, segs: [{ syl: syllables(r.title), w: 4 }, { syl: syllables(r.teacher ?? ""), w: 2.5 }, { syl: syllables(r.series ?? ""), w: 2.5 }] })),
    ...l.results.map((r): Entry => ({ kind: "lesson", id: r.id, courseId: r.course_id, segs: [{ syl: syllables(r.title), w: 2 }, { syl: syllables(r.ct), w: 1 }, { syl: syllables(r.cs ?? ""), w: 1 }] })),
  ];
  cache = { at: Date.now(), rows };
  return rows;
}

/** 查詢 → 同音／近音的課程與章節編號（相似度高的在前）。查詢少於 2 個音節不比對（太短會亂配）。 */
export async function phoneticSearch(db: D1Database, q: string, limit = 24): Promise<{ courses: string[]; lessons: string[] }> {
  const st = await loadSearchSettings(db);
  if (!st.phoneticEnabled) return { courses: [], lessons: [] };
  const qs = syllables(q.trim().slice(0, 100));
  if (qs.length < (st.phoneticMinSyllables as number)) return { courses: [], lessons: [] };
  const k = allow(qs.length, st.phoneticTypoFrom as number);
  // 整串連續符合（最高分）；否則「拆片段」：查詢裡每一段連續的音節只要在這筆資料的任何欄位出現就算覆蓋到，
  // 覆蓋率夠高就列出，覆蓋越多排越前面（業主 2026-11-25：「一支援安裝」＝「益之源」同音錯字＋「安裝」，中間隔著別的字）。
  const n = qs.length;
  const score = (e: Entry) => {
    let best = 0;
    for (const s of e.segs) {
      if (!s.syl.length) continue;
      if (approxSyl(s.syl, qs, 0)) best = Math.max(best, s.w + 0.5);
      else if (k && approxSyl(s.syl, qs, k)) best = Math.max(best, s.w - 1.5);
    }
    if (best > 0 || n < 4) return best;
    const covered = new Array<boolean>(n).fill(false);
    let w = 0;
    for (let len = n - 1; len >= 2; len--) {
      for (let st0 = 0; st0 + len <= n; st0++) {
        if (covered.slice(st0, st0 + len).every(Boolean)) continue;
        const win = qs.slice(st0, st0 + len);
        for (const s of e.segs) {
          if (s.syl.length && approxSyl(s.syl, win, 0)) {
            for (let i = st0; i < st0 + len; i++) covered[i] = true;
            w = Math.max(w, s.w);
            break;
          }
        }
      }
    }
    const cov = covered.filter(Boolean).length / n;
    return cov >= 0.75 ? w * cov : 0;
  };
  const hit = (await load(db)).map((e) => ({ e, s: score(e) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return { courses: hit.filter((x) => x.e.kind === "course").slice(0, limit).map((x) => x.e.id), lessons: hit.filter((x) => x.e.kind === "lesson").slice(0, limit).map((x) => x.e.id) };
}
