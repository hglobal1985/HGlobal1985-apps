import { aiResponseText, prepareVisionImage } from "./ai-image.ts";
/**
 * EDM 圖片辨識（杜杜龍 2026-11-23）：用 Workers AI 的視覺模型（設定 → AI 模型 →「EDM 圖片辨識」選用）讀出海報上的文字與活動日期，
 * 存在 cover_media 的 ocr_text／event_date，用於搜尋與 EDM 依活動日期排序。額度走 reserveAi（和其他 AI 工作共用每日免費額度）。
 */
import { loadSearchSettings } from "./search-settings.ts";
import type { D1Database, Env } from "./d1.ts";
import { AiStopped, loadSelection, markExhausted, refundAi, reserveAi } from "./ai-models.ts";
import { cleanOcrText, structureEdm, structurePending } from "./edm-structure.ts";

const MAX_BYTES = 3 * 1024 * 1024;
const toBase64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

const validDate = (y: number, m: number, d: number): string | null => {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return new Date(iso + "T00:00:00Z").toISOString().slice(0, 10) === iso ? iso : null;
};
/**
 * 從辨識出的文字推活動日期（杜杜龍 2026-11-26 規定）：EDM 上的日期通常沒寫年份，年份取「離上傳日最近」的那一年（台灣時間；
 * 試上傳前一年、當年、後一年三種，挑與上傳日相差天數最少的，所以 1 月上傳 12 月的海報會是前一年、12 月上傳 1 月的活動會是隔年）。
 * 海報上明確寫了完整年份（YYYY-MM-DD／YYYY年M月D日／YYYY/M/D）就照海報。找不到回 null。
 * uploaded＝這張 EDM 上傳的時間（沒給就用現在）。
 */
export function inferDate(text: string, uploaded = new Date()): string | null {
  const full = /(20\d{2})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/.exec(text);
  if (full) {
    const v = validDate(+full[1]!, +full[2]!, +full[3]!);
    if (v) return v;
  }
  const md = /(\d{1,2})\s*(?:\/|月)\s*(\d{1,2})\s*日?/.exec(text);
  if (!md) return null;
  const tw = new Date(uploaded.getTime() + 8 * 3600_000);
  const base = Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate());
  const cands = [-1, 0, 1].map((d) => validDate(tw.getUTCFullYear() + d, +md[1]!, +md[2]!)).filter((x): x is string => !!x);
  return cands.sort((a, b) => Math.abs(Date.parse(a) - base) - Math.abs(Date.parse(b) - base))[0] ?? null;
}

/** 從模型回的文字找出 JSON；活動日期必須是真實存在的 YYYY-MM-DD，否則當作沒有。 */
export function parseVision(raw: string, uploaded?: Date): { text: string; date: string | null } {
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
  // 日期以程式從文字推的為準（沒寫年份一律用上傳年）；推不出來才用模型給的合法日期。
  const inferred = inferDate(clean, uploaded);
  return { text: clean, date: inferred ?? (ok ? date : null) };
}

/** 辨識一張 EDM 圖；成功寫入結果。額度用完（AiStopped）不改狀態，之後再試。 */
export async function ocrEdmImage(env: Env, db: D1Database, rowId: string): Promise<void> {
  if (!env.AI || !env.MEDIA) return;
  const claim = await db.prepare("UPDATE cover_media SET ocr_status = 'working', ocr_at = ? WHERE id = ? AND kind = 'image' AND (ocr_status = '' OR (ocr_status = 'working' AND ocr_at < ?))").bind(new Date().toISOString(), rowId, new Date(Date.now() - 600_000).toISOString()).run();
  if (!claim.meta?.changes) return;
  const row = await db.prepare("SELECT r2_key, created_at FROM cover_media WHERE id = ?").bind(rowId).first<{ r2_key: string; created_at: string | null }>();
  if (!row) return;
  const release = () => db.prepare("UPDATE cover_media SET ocr_status = '' WHERE id = ? AND ocr_status = 'working'").bind(rowId).run();
  const model = (await loadSelection(db)).edm_vision!;
  const fail = async () => void (await db.prepare("UPDATE cover_media SET ocr_status = 'failed', ocr_model = ? WHERE id = ?").bind(model, rowId).run());
  const obj = await env.MEDIA.get(row.r2_key);
  if (!obj) return fail();
  let bytes: Uint8Array = new Uint8Array(await new Response(obj.body).arrayBuffer());
  let type = obj.httpMetadata?.contentType ?? "image/jpeg";
  ({ bytes, type } = await prepareVisionImage(env, bytes, type, 1600));
  if (!bytes.length || bytes.length > MAX_BYTES) return fail();
  let est = 0;
  try {
    est = await reserveAi(db, model, { inputTokens: 2500, outputTokens: 500 }); // 額度用完會丟 AiStopped（呼叫端接住，之後再試）
  } catch (e) {
    await release();
    throw e;
  }
  // 注意：不可把「今天日期」放進提示——模型會把它當成海報內容寫進辨識文字（杜杜龍 2026-11-24 回報）。日期由程式從文字推（inferDate）。
  const prompt = `你是文字辨識（OCR）工具。請把這張活動海報（EDM）上「看得到的文字」逐字抄寫出來（中文為主），依畫面由上到下、由左到右，換行用 \\n。嚴格規定：只能寫圖片上實際出現的文字；不可以寫任何你自己的話、說明、開場白、判斷或猜測；不要使用 Markdown 符號（例如 ** ###）。event_date 只有在海報上明確寫出完整日期時才填（YYYY-MM-DD），沒寫就填 null，不可猜。只回傳 JSON，不要其他說明：{"text":"圖片上的全部文字","event_date":"YYYY-MM-DD 或 null"}`;
  let out = "";
  try {
    const dataUri = `data:${type};base64,${toBase64(bytes)}`;
    const res = (await env.AI.run(model as never, { messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUri } }] }], max_tokens: (await loadSearchSettings(db)).edmVisionMaxTokens as number } as never)) as { response?: unknown; choices?: { message?: { content?: string } }[] };
    out = aiResponseText(res);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/3036|daily free allocation/i.test(msg)) {
      await markExhausted(db);
      await release();
      throw new AiStopped("今天的 AI 免費額度已用完");
    }
    await refundAi(db, est);
    if (/5018|not allowed to access/i.test(msg)) {
      // 這個帳號不能用所選的模型（例如 Gemma 3）：這張不算失敗，退回排隊，並停止這一輪，請杜杜龍到 設定 › AI 模型 換模型。
      await release();
      throw new AiStopped("這個帳號不能使用所選的 AI 模型，請到「設定 › AI 模型」改選 Llama 4 Scout");
    }
    if (/5016|agree|license/i.test(msg)) {
      // Llama 3.2 Vision 第一次使用要先同意 Meta 授權（送一次 "agree"），之後會自動重試。
      await env.AI.run(model as never, { prompt: "agree" } as never).catch(() => undefined);
      await release();
      return;
    }
    return fail();
  }
  let parsed: { text: string; date: string | null };
  try {
    parsed = parseVision(out, row.created_at ? new Date(row.created_at) : undefined);
  } catch {
    return fail(); // 解析出錯不可卡在「處理中」
  }
  const { text, date } = parsed;
  await db.prepare("UPDATE cover_media SET ocr_text = ?, event_date = ?, ocr_status = 'done', ocr_model = ?, ocr_fields = '', ocr_fmt = '' WHERE id = ?").bind(text, date, model, rowId).run();
  // 接著套入欄位格式（杜杜龍 2026-11-24）；額度用完或失敗不影響辨識結果，之後背景會補整理。
  await structureEdm(env, db, rowId).catch(() => undefined);
}

/** 還沒辨識的中心 EDM 圖編號（批次排程 ai-batch.ts 用）。 */
export async function edmOcrIds(db: D1Database, limit: number): Promise<string[]> {
  const { results } = await db.prepare("SELECT id FROM cover_media WHERE owner_kind = 'center' AND scope = 'edm' AND kind = 'image' AND (ocr_status = '' OR (ocr_status = 'working' AND ocr_at < ?)) ORDER BY created_at DESC LIMIT ?").bind(new Date(Date.now() - 600_000).toISOString(), limit).all<{ id: string }>();
  return results.map((r) => r.id);
}

/** 背景處理還沒辨識的中心 EDM 圖（每次最多 limit 張；額度用完或沒綁定 AI 就停）。 */
export async function ocrPending(env: Env, db: D1Database, limit = 3): Promise<void> {
  await fillMissingEdmDates(db);
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

/**
 * 只補「還沒有活動日期」的已辨識 EDM（用已存的文字依 `inferDate` 推，不用 AI）。已經有日期的不會被改動
 * （杜杜龍 2026-11-26：改成「最近年份」規則後，舊的不用重算）。
 */
export async function fillMissingEdmDates(db: D1Database): Promise<number> {
  const { results } = await db.prepare("SELECT id, ocr_text, event_date, created_at FROM cover_media WHERE scope = 'edm' AND kind = 'image' AND ocr_status = 'done' AND ocr_text <> '' AND event_date IS NULL LIMIT 500").all<{ id: string; ocr_text: string; event_date: string | null; created_at: string | null }>();
  let n = 0;
  for (const r of results) {
    const d = inferDate(r.ocr_text, r.created_at ? new Date(r.created_at) : undefined);
    if (d && d !== r.event_date) {
      await db.prepare("UPDATE cover_media SET event_date = ? WHERE id = ?").bind(d, r.id).run();
      n++;
    }
  }
  return n;
}
