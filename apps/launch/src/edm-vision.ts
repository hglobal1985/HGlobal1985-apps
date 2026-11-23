/**
 * EDM 圖片辨識（業主 2026-11-23）：用 Workers AI 的視覺模型（設定 → AI 模型 →「EDM 圖片辨識」選用）讀出海報上的文字與活動日期，
 * 存在 cover_media 的 ocr_text／event_date，用於搜尋與 EDM 依活動日期排序。額度走 reserveAi（和其他 AI 工作共用每日免費額度）。
 */
import type { D1Database, Env } from "./d1.ts";
import { AiStopped, loadSelection, markExhausted, refundAi, reserveAi } from "./ai-models.ts";

const MAX_BYTES = 3 * 1024 * 1024;
const toBase64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

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
  return { text: text.replace(/\s+/g, " ").trim().slice(0, 3000), date: ok ? date : null };
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
  const prompt = `這是一張活動海報（EDM）。請讀出圖片上所有的文字（中文為主），並找出「活動舉辦日期」。今天是 ${today}；海報上沒寫年份時，請用最接近今天的合理年份。只回傳 JSON，不要其他說明：{"text":"圖片上的全部文字","event_date":"YYYY-MM-DD 或 null"}`;
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
  await db.prepare("UPDATE cover_media SET ocr_text = ?, event_date = ?, ocr_status = 'done', ocr_model = ? WHERE id = ?").bind(text, date, model, rowId).run();
}

/** 背景處理還沒辨識的中心 EDM 圖（每次最多 limit 張；額度用完或沒綁定 AI 就停）。 */
export async function ocrPending(env: Env, db: D1Database, limit = 3): Promise<void> {
  if (!env.AI) return;
  const { results } = await db.prepare("SELECT id FROM cover_media WHERE owner_kind = 'center' AND scope = 'edm' AND kind = 'image' AND (ocr_status = '' OR (ocr_status = 'working' AND ocr_at < ?)) ORDER BY created_at DESC LIMIT ?").bind(new Date(Date.now() - 600_000).toISOString(), limit).all<{ id: string }>();
  for (const r of results) {
    try {
      await ocrEdmImage(env, db, r.id);
    } catch (e) {
      if (e instanceof AiStopped) return;
    }
  }
}
