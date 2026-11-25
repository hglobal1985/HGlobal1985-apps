/**
 * 語意搜尋（業主 2026-11-23，與前端「模糊比對」並用）：用 AI 模型清單裡的「語意搜尋」模型（預設 BGE-M3）把課程名稱、章節標題轉成向量，
 * 搜尋時把查詢文字也轉成向量，找出意思最接近的課程與章節。只回編號——能不能看到由前端依自己已取得的（有權限的）索引過濾。
 * 向量存在 D1 `search_vectors`（int8 量化＋base64），排程每 10 分鐘補一批；額度走 AI 點數預扣（用完就停，不影響其他搜尋）。
 */
import type { D1Database, Env } from "./d1.ts";
import { loadSearchSettings } from "./search-settings.ts";
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

/** 排程：替還沒有向量（或標題改過）的已上架課程與章節補向量，每次最多 3 批。額度用完或沒綁定 AI 就停。 */
export async function indexSearchVectors(env: Env, db: D1Database = env.DB): Promise<number> {
  if (!env.AI) return 0;
  await db.prepare("DELETE FROM search_vectors WHERE (kind = 'course' AND ref_id NOT IN (SELECT id FROM courses)) OR (kind = 'lesson' AND ref_id NOT IN (SELECT id FROM lessons))").run();
  let done = 0;
  for (let round = 0; round < 3; round++) {
    const { results } = await db
      .prepare(
        `SELECT 'course' AS kind, c.id AS ref_id, c.title AS txt FROM courses c LEFT JOIN search_vectors v ON v.kind = 'course' AND v.ref_id = c.id WHERE c.status = 'published' AND c.title <> '' AND (v.ref_id IS NULL OR v.txt <> c.title)
         UNION ALL
         SELECT 'lesson', l.id, l.title FROM lessons l JOIN courses c ON c.id = l.course_id LEFT JOIN search_vectors v ON v.kind = 'lesson' AND v.ref_id = l.id WHERE c.status = 'published' AND l.title <> '' AND (v.ref_id IS NULL OR v.txt <> l.title)
         LIMIT ?`,
      )
      .bind(BATCH)
      .all<{ kind: string; ref_id: string; txt: string }>();
    if (!results.length) break;
    try {
      const vecs = await embed(env, db, results.map((r) => r.txt.slice(0, 200)));
      await db.batch(results.map((r, i) => db.prepare("INSERT OR REPLACE INTO search_vectors (kind, ref_id, txt, vec) VALUES (?, ?, ?, ?)").bind(r.kind, r.ref_id, r.txt, packVec(vecs[i]!))));
      done += results.length;
    } catch (e) {
      if (e instanceof AiStopped) break;
      console.error("search vectors", e instanceof Error ? e.message : "error");
      break;
    }
  }
  if (done) cache = null;
  return done;
}

type Row = { kind: string; id: string; v: Int8Array };
let cache: { at: number; rows: Row[] } | null = null;
async function allVectors(db: D1Database): Promise<Row[]> {
  if (cache && Date.now() - cache.at < 600_000) return cache.rows;
  const { results } = await db.prepare("SELECT kind, ref_id, vec FROM search_vectors").all<{ kind: string; ref_id: string; vec: string }>();
  const rows = results.map((r) => ({ kind: r.kind, id: r.ref_id, v: unpackVec(r.vec) }));
  cache = { at: Date.now(), rows };
  return rows;
}

/** 查詢文字 → 意思最接近的課程與章節編號（依相似度由高到低，各最多 limit 個）。額度用完或沒有向量回空清單。 */
export async function semanticSearch(env: Env, db: D1Database, q: string, limitArg?: number): Promise<{ courses: string[]; lessons: string[] }> {
  const text = q.trim().slice(0, 100);
  if (text.length < 2) return { courses: [], lessons: [] };
  const st = await loadSearchSettings(db); // 門檻、筆數由「搜尋與 AI 設定」決定
  if (!st.semanticEnabled) return { courses: [], lessons: [] };
  const limit = limitArg ?? (st.semanticLimit as number);
  const min = st.semanticMin as number;
  const rows = await allVectors(db);
  if (!rows.length) return { courses: [], lessons: [] };
  let qv: Int8Array;
  try {
    qv = unpackVec(packVec((await embed(env, db, [text]))[0]!));
  } catch {
    return { courses: [], lessons: [] };
  }
  const scored = rows.map((r) => ({ r, s: cosine(qv, r.v) })).filter((x) => x.s >= min).sort((a, b) => b.s - a.s);
  return { courses: scored.filter((x) => x.r.kind === "course").slice(0, limit).map((x) => x.r.id), lessons: scored.filter((x) => x.r.kind === "lesson").slice(0, limit).map((x) => x.r.id) };
}

/** 試搜尋（設定頁用，超級管理員）：列出最接近的前 N 筆與相似度分數，方便依實際數字調「相似度門檻」。不套用門檻與開關。 */
export async function semanticDebug(env: Env, db: D1Database, q: string, n = 20): Promise<{ min: number; rows: { kind: string; title: string; score: number }[]; note?: string }> {
  const st = await loadSearchSettings(db);
  const min = st.semanticMin as number;
  const text = q.trim().slice(0, 100);
  if (text.length < 2) return { min, rows: [], note: "請輸入至少 2 個字" };
  const rows = await allVectors(db);
  if (!rows.length) return { min, rows: [], note: "還沒有建立向量索引（排程每 10 分鐘補一批）" };
  let qv: Int8Array;
  try {
    qv = unpackVec(packVec((await embed(env, db, [text]))[0]!));
  } catch {
    return { min, rows: [], note: "AI 沒有回應（額度用完或模型未啟用）" };
  }
  const top = rows.map((r) => ({ r, s: cosine(qv, r.v) })).sort((a, b) => b.s - a.s).slice(0, n);
  const courseIds = top.filter((x) => x.r.kind === "course").map((x) => x.r.id);
  const lessonIds = top.filter((x) => x.r.kind === "lesson").map((x) => x.r.id);
  const titles = new Map<string, string>();
  for (const [table, ids] of [["courses", courseIds], ["lessons", lessonIds]] as const) {
    if (!ids.length) continue;
    const { results } = await db.prepare(`SELECT id, title FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string; title: string }>();
    for (const r of results) titles.set(r.id, r.title);
  }
  return { min, rows: top.map((x) => ({ kind: x.r.kind === "course" ? "課程" : "章節", title: titles.get(x.r.id) ?? x.r.id, score: Math.round(x.s * 1000) / 1000 })) };
}
