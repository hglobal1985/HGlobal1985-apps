/**
 * 語意搜尋（業主 2026-11-23，與前端「模糊比對」並用）：用 AI 模型清單裡的「語意搜尋」模型（預設 BGE-M3）把課程名稱、章節標題轉成向量，
 * 搜尋時把查詢文字也轉成向量，找出意思最接近的課程與章節。只回編號——能不能看到由前端依自己已取得的（有權限的）索引過濾。
 * 向量存在 D1 `search_vectors`（int8 量化＋base64），排程每 10 分鐘補一批；額度走 AI 點數預扣（用完就停，不影響其他搜尋）。
 */
import type { D1Database, Env } from "./d1.ts";
import { loadSearchSettings } from "./search-settings.ts";
import { SOURCES, candidates, resolveHits, tagOf, type Hit, type SourceKind } from "./search-sources.ts";
import { AiStopped, loadSelection, markExhausted, refundAi, reserveAi } from "./ai-models.ts";

/** 相似度門檻：低於這個不算相近（BGE-M3 的餘弦相似度；偏保守，寧可少一點也不要不相干）。 */
export const SEMANTIC_MIN = 0.62; // 2026-11-25 由 0.55 小幅提高（搜「水機」連雅姿、紐崔萊都被撈進來）
const BATCH = 100;

/** 向量正規化後量化成 int8，轉成 base64。 */
export function packVec(v: number[]): string {
  const norm = Math.sqrt(v.reduce((n, x) => n + x * x, 0)) || 1;
  const bytes = new Uint8Array(v.length);
  for (let i = 0; i < v.length; i++) bytes[i] = Math.max(-127, Math.min(127, Math.round((v[i]! / norm) * 127))) & 0xff;
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unpackVec(b64: string): Int8Array {
  const s = atob(b64);
  const out = new Int8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = (s.charCodeAt(i) << 24) >> 24;
  return out;
}
/** 兩個已正規化的 int8 向量的餘弦相似度（約略值）。 */
export function cosine(a: Int8Array, b: Int8Array): number {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) d += a[i]! * b[i]!;
  return d / (127 * 127);
}

async function embed(env: Env, db: D1Database, texts: string[]): Promise<number[][]> {
  if (!env.AI) throw new AiStopped("尚未綁定 Workers AI");
  const model = (await loadSelection(db)).embedding!;
  const est = await reserveAi(db, model, { inputTokens: texts.reduce((n, t) => n + t.length + 2, 0) });
  try {
    const res = (await env.AI.run(model as never, { text: texts } as never)) as { data?: number[][] };
    if (!res?.data || res.data.length !== texts.length) throw new Error("embedding_failed");
    return res.data;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/3036|daily free allocation/i.test(msg)) {
      await markExhausted(db);
      throw new AiStopped("今天的 AI 免費額度已用完");
    }
    await refundAi(db, est);
    throw e;
  }
}

/** 排程：替還沒有向量（或文字改過）的各類資料補向量（課程、教材、區塊、系列、中心、課程介紹、EDM、相片；見 search-sources.ts），每次最多 3 批。額度用完或沒綁定 AI 就停。 */
export async function indexSearchVectors(env: Env, db: D1Database = env.DB): Promise<number> {
  if (!env.AI) return 0;
  const st = await loadSearchSettings(db);
  const enabled = new Set(SOURCES.filter((x) => st[x.param]).map((x) => x.kind));
  const cands = await candidates(db, (k) => enabled.has(k));
  const have = new Map((await db.prepare("SELECT kind, ref_id, txt FROM search_vectors").all<{ kind: string; ref_id: string; txt: string }>()).results.map((r) => [`${r.kind}\u0001${r.ref_id}`, r.txt]));
  // 已不存在（下架、刪除）的資料：只清「已開啟的來源」，沒開的來源向量留著，重新打開就能立刻用。
  const live = new Set(cands.map((x) => `${x.kind}\u0001${x.ref}`));
  const gone = [...have.keys()].filter((k) => !live.has(k) && enabled.has(k.split("\u0001")[0] as SourceKind));
  for (let i = 0; i < gone.length; i += 50) await db.batch(gone.slice(i, i + 50).map((k) => db.prepare("DELETE FROM search_vectors WHERE kind = ? AND ref_id = ?").bind(...(k.split("\u0001") as [string, string]))));
  const todo = cands.filter((x) => have.get(`${x.kind}\u0001${x.ref}`) !== x.txt);
  let done = 0;
  for (let round = 0; round < 3; round++) {
    const batch = todo.slice(round * BATCH, (round + 1) * BATCH);
    if (!batch.length) break;
    try {
      const vecs = await embed(env, db, batch.map((r) => r.txt.slice(0, 200)));
      await db.batch(batch.map((r, i) => db.prepare("INSERT OR REPLACE INTO search_vectors (kind, ref_id, txt, vec) VALUES (?, ?, ?, ?)").bind(r.kind, r.ref, r.txt, packVec(vecs[i]!))));
      done += batch.length;
    } catch (e) {
      if (e instanceof AiStopped) break;
      console.error("search vectors", e instanceof Error ? e.message : "error");
      break;
    }
  }
  if (done || gone.length) cache = null;
  return done;
}

type Row = { kind: string; id: string; txt: string; v: Int8Array };
let cache: { at: number; rows: Row[] } | null = null;
async function allVectors(db: D1Database): Promise<Row[]> {
  if (cache && Date.now() - cache.at < 600_000) return cache.rows;
  const { results } = await db.prepare("SELECT kind, ref_id, txt, vec FROM search_vectors").all<{ kind: string; ref_id: string; txt: string; vec: string }>();
  const rows = results.map((r) => ({ kind: r.kind, id: r.ref_id, txt: r.txt, v: unpackVec(r.vec) }));
  cache = { at: Date.now(), rows };
  return rows;
}

/**
 * 字面相關度（業主 2026-11-25：搜「晚安修護面膜」，出來一堆完全不相干的 EDM）：AI 相似度之外，再看查詢字的「相鄰兩字」有幾成出現在這筆文字裡。
 * 加分＝0.3 × 命中比例；EDM、相片、課程介紹這類長文字最容易被 AI 誤判，完全沒有任何相鄰兩字命中的直接扣 0.5（等於不列）。後台「試搜尋」與實際搜尋共用。
 */
export function lexAdjust(query: string, txt: string, kind: string, bonus = 0.3, penalty = 0.5): number {
  const q = query.toLowerCase().replace(/[\s\u3000]+/g, "");
  const t = txt.toLowerCase().replace(/[\s\u3000]+/g, "");
  const grams = new Set<string>();
  for (let i = 0; i + 1 < q.length; i++) grams.add(q.slice(i, i + 2));
  if (!grams.size) return 0;
  let hit = 0;
  for (const g of grams) if (t.includes(g)) hit++;
  const cov = hit / grams.size;
  const noisy = kind === "edm" || kind === "photo" || kind === "intro";
  return bonus * cov - (noisy && hit === 0 ? penalty : 0);
}

/** 查詢文字 → 意思最接近的課程、教材編號（前端依自己的索引過濾）＋其他類別的命中（系列、中心、區塊、課程介紹、EDM、相片；已附標題、連結與膠囊標籤）。依相似度由高到低，各最多 limit 個。額度用完或沒有向量回空。 */
export async function semanticSearch(env: Env, db: D1Database, q: string, limitArg?: number): Promise<{ courses: string[]; lessons: string[]; extras: Hit[]; coursePrio: number }> {
  const none = { courses: [], lessons: [], extras: [], coursePrio: 9 };
  const text = q.trim().slice(0, 100);
  if (text.length < 2) return none;
  const st = await loadSearchSettings(db); // 門檻、筆數、資料來源由「搜尋與 AI 設定」決定
  if (!st.semanticEnabled) return none;
  const limit = limitArg ?? (st.semanticLimit as number);
  const min = st.semanticMin as number;
  const enabled = new Set(SOURCES.filter((x) => st[x.param]).map((x) => x.kind as string));
  const rows = (await allVectors(db)).filter((r) => enabled.has(r.kind));
  if (!rows.length) return none;
  let qv: Int8Array;
  try {
    qv = unpackVec(packVec((await embed(env, db, [text]))[0]!));
  } catch {
    return none;
  }
  const boost = (kind: string) => Number(st[`semBoost${kind.charAt(0).toUpperCase()}${kind.slice(1)}`] ?? 0);
  const prio = (kind: string) => Number(st[`semPrio${kind.charAt(0).toUpperCase()}${kind.slice(1)}`] ?? 5);
  const scored = rows.map((r) => ({ r, s: cosine(qv, r.v) + boost(r.kind) + lexAdjust(text, r.txt, r.kind, Number(st.lexBonus ?? 0.3), Number(st.lexPenalty ?? 0.5)) })).filter((x) => x.s >= min).sort((a, b) => b.s - a.s);
  const other = scored.filter((x) => x.r.kind !== "course" && x.r.kind !== "lesson").slice(0, limit);
  const extras = await resolveHits(db, other.map((x) => ({ kind: x.r.kind as SourceKind, ref: x.r.id, txt: x.r.txt, score: Math.round(x.s * 1000) / 1000 })));
  // 單一教材也列在「其他項目」（標籤：單一教材），不再把它的課程混進課程清單。
  const lessonHits = await resolveHits(db, scored.filter((x) => x.r.kind === "lesson").slice(0, limit).map((x) => ({ kind: "lesson" as const, ref: x.r.id, txt: x.r.txt, score: Math.round(x.s * 1000) / 1000 })));
  return { courses: scored.filter((x) => x.r.kind === "course").slice(0, limit).map((x) => x.r.id), lessons: scored.filter((x) => x.r.kind === "lesson").slice(0, limit).map((x) => x.r.id), extras: [...extras, ...lessonHits].map((h) => ({ ...h, prio: prio(h.kind) })).sort((a, b) => a.prio - b.prio || b.score - a.score), coursePrio: prio("course") };
}

/** 試搜尋（設定頁用，超級管理員）：跟實際搜尋同一套規則——只列「已開啟」的來源、分數含加分、依「顯示順序」再依分數排序、標出過不過門檻。業主 2026-11-25：以這裡的結果為最終樣式。 */
export async function semanticDebug(env: Env, db: D1Database, q: string, n = 20): Promise<{ min: number; rows: { kind: string; title: string; score: number; boost: number; pass: boolean }[]; note?: string }> {
  const st = await loadSearchSettings(db);
  const min = st.semanticMin as number;
  const text = q.trim().slice(0, 100);
  if (text.length < 2) return { min, rows: [], note: "請輸入至少 2 個字" };
  const enabled = new Set(SOURCES.filter((x) => st[x.param]).map((x) => x.kind as string));
  const rows = (await allVectors(db)).filter((r) => enabled.has(r.kind));
  if (!rows.length) return { min, rows: [], note: "還沒有建立向量索引，或所有來源都關閉了（排程每 10 分鐘補一批）" };
  let qv: Int8Array;
  try {
    qv = unpackVec(packVec((await embed(env, db, [text]))[0]!));
  } catch {
    return { min, rows: [], note: "AI 沒有回應（額度用完或模型未啟用）" };
  }
  const cap = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);
  const boost = (kind: string) => Number(st[`semBoost${cap(kind)}`] ?? 0);
  const prio = (kind: string) => Number(st[`semPrio${cap(kind)}`] ?? 5);
  const scored = rows.map((r) => ({ r, s: cosine(qv, r.v) + boost(r.kind) + lexAdjust(text, r.txt, r.kind, Number(st.lexBonus ?? 0.3), Number(st.lexPenalty ?? 0.5)) }));
  // 先取分數最高的 n 筆，再照實際顯示順序排（過門檻的在前）。
  const top = scored.sort((a, b) => b.s - a.s).slice(0, n).sort((a, b) => Number(b.s >= min) - Number(a.s >= min) || prio(a.r.kind) - prio(b.r.kind) || b.s - a.s);
  return { min, rows: top.map((x) => ({ kind: tagOf(x.r.kind), title: x.r.txt.replace(/\s+/g, " ").slice(0, 80), score: Math.round(x.s * 1000) / 1000, boost: boost(x.r.kind), pass: x.s >= min })) };
}
