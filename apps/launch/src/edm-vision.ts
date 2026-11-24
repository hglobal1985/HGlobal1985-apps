/**
 * EDM 圖片辨識（業主 2026-11-23）：用 Workers AI 的視覺模型（設定 → AI 模型 →「EDM 圖片辨識」選用）讀出海報上的文字與活動日期，
 * 存在 cover_media 的 ocr_text／event_date，用於搜尋與 EDM 依活動日期排序。額度走 reserveAi（和其他 AI 工作共用每日免費額度）。
 */
import type { D1Database, Env } from "./d1.ts";
import { AiStopped, loadSelection, markExhausted, refundAi, reserveAi } from "./ai-models.ts";
import { cleanOcrText, structureEdm, structurePending } from "./edm-structure.ts";

const MAX_BYTES = 3 * 1024 * 1024;
const toBase64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

const WEEK = "日一二三四五六";
const validDate = (y: number, m: number, d: number): string | null => {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return new Date(iso + "T00:00:00Z").toISOString().slice(0, 10) === iso ? iso : null;
};
/**
 * 從辨識出的文字推活動日期（模型常常不照格式回，或猜錯年份）：
 * 優先找完整的 YYYY-MM-DD／YYYY年M月D日／YYYY/M/D；其次找「M/D」「M月D日」，有寫星期（例如「11/24日（二）」）就挑星期對得上的年份，
 * 沒寫星期就挑離今天最近的年份。找不到回 null。
 */
export function inferDate(text: string, now = new Date()): string | null {
  const near = (c: string[]) => c.sort((a, b) => Math.abs(Date.parse(a) - +now) - Math.abs(Date.parse(b) - +now))[0] ?? null;
  const md = /(\d{1,2})\s*(?:\/|月)\s*(\d{1,2})\s*日?\s*[（(]?\s*(?:週|周|星期)?\s*([日一二三四五六])?/.exec(text);
  const y0 = now.getUTCFullYear();
  const cands = md ? [y0 - 1, y0, y0 + 1].map((y) => validDate(y, +md[1]!, +md[2]!)).filter((x): x is string => !!x) : [];
  // ① 寫了星期：挑星期對得上的年份（模型猜的年份常常錯）
  if (md?.[3]) {
    const wd = WEEK.indexOf(md[3]);
    const hit = near(cands.filter((c) => new Date(c + "T00:00:00Z").getUTCDay() === wd));
    if (hit) return hit;
  }
  // ② 有完整年月日
  const full = /(20\d{2})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/.exec(text);
  if (full) {
    const v = validDate(+full[1]!, +full[2]!, +full[3]!);
    if (v) return v;
  }
  // ③ 只有月日：挑離今天最近的年份
  return near(cands);
}

/** 從模型回的文字找出 JSON；活動日期必須是真實存在的 YYYY-MM-DD，否則當作沒有。 */
export function parseVision(raw: string): { text: string; date: string | null } {
  const m = /\{[\s\S]*\}/.exec(raw);
  let text = "";
  let date: string | null = null;
  if (m) {
    try {
      const j = JSON.parse(m[0]) as { text?: unknown; event_date?: unknown };
      text = typeof j.text === "string" ? j.text : Array.isArray(j.text) ? j.text.join("\n") : "";
      date = typeof j.event_date === "string" ? j.event_date.trim() : null;
    } catch {
      text = raw;
    }
  } else text = raw;
  const ok = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date + "T00:00:00Z")) && new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date && +date.slice(0, 4) >= 2000 && +date.slice(0, 4) <= 2100;
  const clean = cleanOcrText(text).slice(0, 3000);
  // 海報上有寫星期的日期比模型猜的年份可靠：兩個不一致時用文字推的；模型沒給合法日期時也用文字推。
  const inferred = inferDate(clean);
  return { text: clean, date: inferred ?? (ok ? date : null) };
}

/** 辨識一張 EDM 圖；成功寫入結果。額度用完（AiStopped）不改狀態，之後再試。 */
export async function ocrEdmImage(env: Env, db: D1Database, rowId: string): Promise<void> {
  if (!env.AI || !env.MEDIA) return;
  const claim = await db.prepare("UPDATE cover_media SET ocr_status = 'working', ocr_at = ? WHERE id = ? AND kind = 'image' AND (ocr_status = '' OR (ocr_status = 'working' AND ocr_at < ?))").bind(new Date().toISOString(), rowId, new Date(Date.now() - 600_000).toISOString()).run();
  if (!claim.meta?.changes) return;
  const row = await db.prepare("SELECT r2_key FROM cover_media WHERE id = ?").bind(rowId).first<{ r2_key: string }>();
  if (!row) return;
  const release = () => db.prepare("UPDATE cover_media SET ocr_status = '' WHERE id = ? AND ocr_status = 'working'").bind(rowId).run();
  const model = (await loadSelection(db)).edm_vision!;
  const fail = async () => void (await db.prepare("UPDATE cover_media SET ocr_status = 'failed', ocr_model = ? WHERE id = ?").bind(model, rowId).run());
  const obj = await env.MEDIA.get(row.r2_key);
  if (!obj) return fail();
  const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return fail();
  const type = obj.httpMetadata?.contentType ?? "image/jpeg";
  let est = 0;
  try {
    est = await reserveAi(db, model, { inputTokens: 2500, outputTokens: 500 }); // 額度用完會丟 AiStopped（呼叫端接住，之後再試）
  } catch (e) {
    await release();
    throw e;
  }
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `這是一張活動海報（EDM）。請讀出圖片上所有的文字（中文為主），並找出「活動舉辦日期」。今天是 ${today}；海報上沒寫年份時，請用最接近今天的合理年份。text 欄位請直接照抄圖片上的文字（依畫面由上到下、由左到右，換行用 \\n），不要分析、不要說明、不要使用 Markdown 符號（例如 ** ###）。只回傳 JSON，不要其他說明：{"text":"圖片上的全部文字","event_date":"YYYY-MM-DD 或 null"}`;
  let out = "";
  try {
    const dataUri = `data:${type};base64,${toBase64(bytes)}`;
    const res = (await env.AI.run(model as never, { messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUri } }] }], max_tokens: 1024 } as never)) as { response?: string; choices?: { message?: { content?: string } }[] };
    out = res?.response ?? res?.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/3036|daily free allocation/i.test(msg)) {
      await markExhausted(db);
      await release();
      throw new AiStopped("今天的 AI 免費額度已用完");
    }
    await refundAi(db, est);
    if (/5016|agree|license/i.test(msg)) {
      // Llama 3.2 Vision 第一次使用要先同意 Meta 授權（送一次 "agree"），之後會自動重試。
      await env.AI.run(model as never, { prompt: "agree" } as never).catch(() => undefined);
      await release();
      return;
    }
    return fail();
  }
  const { text, date } = parseVision(out);
  await db.prepare("UPDATE cover_media SET ocr_text = ?, event_date = ?, ocr_status = 'done', ocr_model = ?, ocr_fields = '', ocr_fmt = '' WHERE id = ?").bind(text, date, model, rowId).run();
  // 接著套入欄位格式（業主 2026-11-24）；額度用完或失敗不影響辨識結果，之後背景會補整理。
  await structureEdm(env, db, rowId).catch(() => undefined);
}

/** 背景處理還沒辨識的中心 EDM 圖（每次最多 limit 張；額度用完或沒綁定 AI 就停）。 */
export async function ocrPending(env: Env, db: D1Database, limit = 3): Promise<void> {
  // 已辨識但沒有日期的，用已存的文字重新推日期（不用 AI）。
  const old = await db.prepare("SELECT id, ocr_text FROM cover_media WHERE scope = 'edm' AND ocr_status = 'done' AND event_date IS NULL AND ocr_text <> '' LIMIT 60").all<{ id: string; ocr_text: string }>();
  for (const r of old.results) {
    const d = inferDate(r.ocr_text);
    if (d) await db.prepare("UPDATE cover_media SET event_date = ? WHERE id = ?").bind(d, r.id).run();
  }
  if (!env.AI) return;
  const { results } = await db.prepare("SELECT id FROM cover_media WHERE owner_kind = 'center' AND scope = 'edm' AND kind = 'image' AND (ocr_status = '' OR (ocr_status = 'working' AND ocr_at < ?)) ORDER BY created_at DESC LIMIT ?").bind(new Date(Date.now() - 600_000).toISOString(), limit).all<{ id: string }>();
  for (const r of results) {
    try {
      await ocrEdmImage(env, db, r.id);
    } catch (e) {
      if (e instanceof AiStopped) return;
    }
  }
  await structurePending(env, db, 2); // 已辨識但還沒套入目前欄位格式的，慢慢補整理
}
