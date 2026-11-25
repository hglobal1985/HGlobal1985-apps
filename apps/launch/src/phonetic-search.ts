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
type Entry = { kind: "course" | "lesson"; id: string; courseId: string; segs: Seg[]; /** 所有欄位的相鄰音節對（快速預篩：片段的前兩個音節不在裡面就不可能符合）。 */ bg?: Set<string> };
let cache: { at: number; rows: Entry[] } | null = null;
/** 測試用：清掉快取。 */
export const resetPhoneticCache = () => { cache = null; };

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
/** 口語問句的虛詞（「如何安裝」「怎麼辦」「請問」…）不拿來比對（業主 2026-11-25）：先去掉再轉拼音。 */
const FILLER = /有沒有|怎麼樣|怎麼辦|怎麼|怎樣|如何|請問|想知道|想要|我要|我想|可以|哪裡|什麼|為什麼|為何|嗎|呢|吧|啊|呀|的|了/g;
export const stripFiller = (q: string) => {
  const t = q.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  return t.length >= 2 ? t : q; // 去完幾乎不剩就維持原樣
};

export async function phoneticSearch(db: D1Database, q: string, limit = 24): Promise<{ courses: string[]; lessons: string[] }> {
  const st = await loadSearchSettings(db);
  if (!st.phoneticEnabled) return { courses: [], lessons: [] };
  const maxSyl = Number(st.phoneticMaxSyllables ?? 40);
  const qText = q.trim().slice(0, 100);
  const qs = syllables(st.phoneticFiller === false ? qText : stripFiller(qText)).slice(0, maxSyl);
  if (qs.length < (st.phoneticMinSyllables as number)) return { courses: [], lessons: [] };
  // 整串連續符合（最高分）；否則「拆片段」：查詢裡每一段連續的音節只要在這筆資料的任何欄位出現就算覆蓋到，
  // 覆蓋率夠高就列出，覆蓋越多排越前面（業主 2026-11-25：「一支援安裝」＝「益之源」同音錯字＋「安裝」，中間隔著別的字）。
  const bigrams = (e: Entry) => (e.bg ??= new Set(e.segs.flatMap((s) => s.syl.slice(0, -1).map((a, i) => `${a}|${s.syl[i + 1]}`))));
  const coverPct = Number(st.phoneticCoverPct ?? 75);
  const longMin = Number(st.phoneticLongMinSyllables ?? 4);
  const scoreOf = (qs: string[]) => {
    const k = allow(qs.length, st.phoneticTypoFrom as number);
    const n = Math.min(qs.length, maxSyl); // 口語長句最多看前幾個音節（後台可調）
    return (e: Entry) => {
    let best = 0;
    for (const s of e.segs) {
      if (!s.syl.length) continue;
      if (approxSyl(s.syl, qs, 0)) best = Math.max(best, s.w + 0.5);
      else if (k && approxSyl(s.syl, qs, k)) best = Math.max(best, s.w - 1.5);
    }
    if (best > 0 || n < 4) return best;
    const bg = bigrams(e);
    if (!qs.slice(0, n - 1).some((a, i) => bg.has(`${a}|${qs[i + 1]}`))) return 0; // 連一對相鄰音節都沒有就不可能
    const covered = new Array<boolean>(n).fill(false);
    let w = 0;
    let longest = 0; // 最長的一段連續符合（越長越代表是同一個詞）
    for (let len = Math.min(n - 1, 8); len >= 2; len--) {
      for (let st0 = 0; st0 + len <= n; st0++) {
        if (covered.slice(st0, st0 + len).every(Boolean)) continue;
        if (!bg.has(`${qs[st0]}|${qs[st0 + 1]}`)) continue;
        const win = qs.slice(st0, st0 + len);
        for (const s of e.segs) {
          if (s.syl.length && approxSyl(s.syl, win, 0)) {
            for (let i = st0; i < st0 + len; i++) covered[i] = true;
            w = Math.max(w, s.w);
            longest = Math.max(longest, len);
            break;
          }
        }
      }
    }
    const got = covered.filter(Boolean).length;
    // 門檻：短查詢（≤5 音節）覆蓋 75%；口語長句（多個關鍵詞串在一起）不看比例——
    // 至少覆蓋 4 個音節，而且有一個 ≥3 音節的詞或覆蓋 ≥6 個音節（避免隨便兩個常見雙字詞就配上）。
    if (n <= 5 ? got < (coverPct / 100) * n : got < longMin || (longest < 3 && got < 6)) return 0;
    // 分數：覆蓋的音節越多越前面；最長詞加一點分。
    return w * (got / n) + got * 0.05 + longest * 0.05;
    };
  };
  const entries = await load(db);
  const best = new Map<string, { e: Entry; s: number }>();
  const run = (qsx: string[], bonus: number) => {
    const sc = scoreOf(qsx);
    for (const e of entries) {
      const s = sc(e);
      if (s > 0) {
        const cur = best.get(`${e.kind}:${e.id}`);
        if (!cur || cur.s < s + bonus) best.set(`${e.kind}:${e.id}`, { e, s: s + bonus });
      }
    }
  };
  run(qs, 0);
  // 自訂關聯詞（業主 2026-11-25：故意打錯字「和本翠」要找得到「漢本萃＝智慧草本＝中藥」）：
  // 查詢的音節與某個關聯詞「相同，或 3 個音節以上差 1 個音節」，就把同組的所有詞也當查詢找一遍（分數略低一點）。
  for (const g of st.synonymPhonetic === false ? [] : await synonymGroups(db)) {
    const typoFrom = Number(st.synonymTypoFrom ?? 3);
    const sylOf = g.map((t) => syllables(t));
    const hitTerm = sylOf.some((ts) => ts.length >= 2 && qs.length >= 2 && Math.abs(ts.length - qs.length) <= 1 && approxSyl(ts, qs, 0) || (ts.length >= typoFrom && qs.length >= 3 && Math.abs(ts.length - qs.length) <= 1 && approxSyl(ts, qs, 1)));
    if (hitTerm) for (const ts of sylOf) if (ts.length >= 2) run(ts.slice(0, maxSyl), -0.3);
  }
  const hit = [...best.values()].sort((a, b) => b.s - a.s);
  return { courses: hit.filter((x) => x.e.kind === "course").slice(0, limit).map((x) => x.e.id), lessons: hit.filter((x) => x.e.kind === "lesson").slice(0, limit).map((x) => x.e.id) };
}

/** 自訂關聯詞各組（每次最多快取 1 分鐘）。 */
let synCache: { at: number; groups: string[][] } | null = null;
async function synonymGroups(db: D1Database): Promise<string[][]> {
  if (synCache && Date.now() - synCache.at < 60_000) return synCache.groups;
  const { results } = await db.prepare("SELECT terms FROM search_synonyms ORDER BY id").all<{ terms: string }>();
  const groups = results.map((r) => { try { return JSON.parse(r.terms) as string[]; } catch { return []; } }).filter((g) => g.length >= 2);
  synCache = { at: Date.now(), groups };
  return groups;
}
export const resetSynonymCache = () => { synCache = null; };
