import { prepareVisionImage } from "./ai-image.ts";
/**
 * 相簿照片文字辨識 OCR（業主 2026-11-25）：讀出照片裡看得到的文字（招牌、白板、產品包裝、投影片…），存到 cover_media.ocr_text，
 * 和「場景標籤」一起用於相簿搜尋（BlockAlbum／中心 EDM 共用的 AlbumSearch 模組）與全站場景搜尋。
 * 只處理區塊照片（中心 EDM 走 edm-vision.ts 的海報辨識；封面不辨識）。用 Workers AI 視覺模型（設定 → AI 模型 →「相簿照片文字辨識」），
 * 額度走 reserveAi（和其他 AI 共用每日免費額度）。「設定 → 搜尋與 AI 設定」可開關（photoOcrEnabled）與調最大輸出長度（photoOcrMaxTokens）。
 */
import type { D1Database, Env } from "./d1.ts";
import { AiStopped, loadSelection, markExhausted, refundAi, reserveAi } from "./ai-models.ts";
import { cleanOcrText } from "./edm-structure.ts";
import { loadSearchSettings } from "./search-settings.ts";

const MAX_BYTES = 3 * 1024 * 1024;
const toBase64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
/** 模型回「沒有文字」之類的說法時，視為空白。 */
const NONE = /^(無|沒有|没有|none|n\/a|no text|無文字|沒有文字|圖片中沒有文字)[。.!！\s]*$/i;

export async function ocrPhoto(env: Env, db: D1Database, rowId: string): Promise<void> {
  if (!env.AI || !env.MEDIA) return;
  const claim = await db
    .prepare("UPDATE cover_media SET ocr_status = 'working', ocr_at = ? WHERE id = ? AND kind = 'image' AND (ocr_status = '' OR (ocr_status = 'working' AND ocr_at < ?))")
    .bind(new Date().toISOString(), rowId, new Date(Date.now() - 10 * 60_000).toISOString())
    .run();
  if (!claim.meta?.changes) return;
  const row = await db.prepare("SELECT r2_key FROM cover_media WHERE id = ?").bind(rowId).first<{ r2_key: string }>();
  if (!row) return;
  const release = () => db.prepare("UPDATE cover_media SET ocr_status = '' WHERE id = ? AND ocr_status = 'working'").bind(rowId).run();
  const model = (await loadSelection(db)).photo_ocr!;
  const fail = async () => void (await db.prepare("UPDATE cover_media SET ocr_status = 'failed', ocr_model = ? WHERE id = ?").bind(model, rowId).run());
  const obj = await env.MEDIA.get(row.r2_key);
  if (!obj) return fail();
  let bytes: Uint8Array = new Uint8Array(await new Response(obj.body).arrayBuffer());
  let type = obj.httpMetadata?.contentType ?? "image/jpeg";
  ({ bytes, type } = await prepareVisionImage(env, bytes, type, 1600));
  if (!bytes.length || bytes.length > MAX_BYTES) return fail();
  let est = 0;
  try {
    est = await reserveAi(db, model, { inputTokens: 2500, outputTokens: 400 });
  } catch (e) {
    await release();
    throw e;
  }
  const prompt = "你是文字辨識（OCR）工具。請把這張照片裡「看得到的文字」逐字抄寫出來（招牌、白板、投影片、產品包裝、標語…），中文為主，由上到下、由左到右，換行用 \\n。嚴格規定：只寫照片上實際出現的文字，不要描述畫面、不要解釋、不要自己補字；完全沒有文字就只回「無」。";
  let out = "";
  try {
    const maxTokens = Number((await loadSearchSettings(db)).photoOcrMaxTokens ?? 600);
    const dataUri = `data:${type};base64,${toBase64(bytes)}`;
    const res = (await env.AI.run(model as never, { messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUri } }] }], max_tokens: maxTokens } as never)) as { response?: string; choices?: { message?: { content?: string } }[] };
    out = res?.response ?? res?.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/3036|daily free allocation/i.test(msg)) {
      await markExhausted(db);
      await release();
      throw new AiStopped("今天的 AI 免費額度已用完");
    }
    await refundAi(db, est);
    if (/5018|not allowed to access/i.test(msg)) {
      // 這個帳號不能用所選的模型（例如 Gemma 3）：這張不算失敗，退回排隊，並停止這一輪，請業主到 設定 › AI 模型 換模型。
      await release();
      throw new AiStopped("這個帳號不能使用所選的 AI 模型，請到「設定 › AI 模型」改選 Llama 4 Scout");
    }
    if (/5016|agree|license/i.test(msg)) {
      await env.AI.run(model as never, { prompt: "agree" } as never).catch(() => undefined);
      await release();
      return;
    }
    return fail();
  }
  let text = NONE.test(out.trim()) ? "" : cleanOcrText(out).slice(0, 2000);
  // 模型卡住亂重複：整段幾乎都是重複垃圾，清掉後剩不到 3 成，視為沒有可用文字。
  if (out.length > 200 && text.length < out.length * 0.15 && text.length < 40) text = "";
  await db.prepare("UPDATE cover_media SET ocr_text = ?, ocr_status = 'done', ocr_model = ? WHERE id = ?").bind(text, model, rowId).run();
}

/** 還沒辨識文字的相簿照片編號（區塊照片；批次排程 ai-batch.ts 用）。 */
export async function photoOcrIds(db: D1Database, limit: number): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT cm.id FROM cover_media cm WHERE cm.owner_kind = 'course' AND cm.kind = 'image' AND (cm.ocr_status = '' OR (cm.ocr_status = 'working' AND cm.ocr_at < ?)) AND EXISTS (SELECT 1 FROM lessons l WHERE l.id = cm.owner_key AND l.kind = 'section') ORDER BY cm.created_at DESC LIMIT ?")
    .bind(new Date(Date.now() - 10 * 60_000).toISOString(), limit)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

/** 背景處理還沒辨識文字的相簿照片（區塊照片；每次最多 limit 張；設定關閉、額度用完或沒綁定 AI 就停）。 */
export async function photoOcrPending(env: Env, db: D1Database, limit = 3): Promise<void> {
  if (!env.AI) return;
  if ((await loadSearchSettings(db)).photoOcrEnabled === false) return;
  const { results } = await db
    .prepare("SELECT cm.id FROM cover_media cm WHERE cm.owner_kind = 'course' AND cm.kind = 'image' AND (cm.ocr_status = '' OR (cm.ocr_status = 'working' AND cm.ocr_at < ?)) AND EXISTS (SELECT 1 FROM lessons l WHERE l.id = cm.owner_key AND l.kind = 'section') ORDER BY cm.created_at DESC LIMIT ?")
    .bind(new Date(Date.now() - 10 * 60_000).toISOString(), limit)
    .all<{ id: string }>();
  for (const r of results) {
    try {
      await ocrPhoto(env, db, r.id);
    } catch (e) {
      if (e instanceof AiStopped) return;
    }
  }
}
