import { aiResponseText, prepareVisionImage } from "./ai-image.ts";
/**
 * 相簿照片場景辨識（業主 2026-11-24）：只辨識「其他相簿」（區塊照片，例如成交百寶箱），不辨識封面、也不辨識中心 EDM（EDM 走文字辨識）。
 * 用 Workers AI 視覺模型（設定 → AI 模型 →「相簿照片場景辨識」）認出行為、場景、物品，存成逗號分隔的短標籤到 cover_media.scene_text。
 * 額度走 reserveAi（和其他 AI 工作共用每日免費額度），用完自動停、隔天續辨。
 */
import type { D1Database, Env } from "./d1.ts";
import { AiStopped, loadSelection, markExhausted, refundAi, reserveAi } from "./ai-models.ts";

const MAX_BYTES = 3 * 1024 * 1024;
const toBase64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

/** 把模型的回答整理成標籤：去掉編號、項目符號、標點、重複，最多 12 個、每個最多 12 字。 */
export function cleanScene(raw: string): string {
  const tags = raw
    .replace(/[`*#]/g, "")
    .split(/[,，、;；\n]+/)
    .map((t) => t.replace(/^\s*(?:[-•·]|\d+[.)、])\s*/, "").replace(/^(場景|行為|物品|標籤)[:：]\s*/, "").replace(/[。.!！?？"'「」()（）]/g, "").trim())
    .filter((t) => t.length >= 1 && t.length <= 12);
  return [...new Set(tags)].slice(0, 12).join("，");
}

export async function sceneImage(env: Env, db: D1Database, rowId: string): Promise<void> {
  if (!env.AI || !env.MEDIA) return;
  const claim = await db
    .prepare("UPDATE cover_media SET scene_status = 'working', scene_at = ? WHERE id = ? AND kind = 'image' AND (scene_status = '' OR (scene_status = 'working' AND scene_at < ?))")
    .bind(new Date().toISOString(), rowId, new Date(Date.now() - 10 * 60_000).toISOString())
    .run();
  if (!claim.meta?.changes) return;
  const row = await db.prepare("SELECT r2_key FROM cover_media WHERE id = ?").bind(rowId).first<{ r2_key: string }>();
  if (!row) return;
  const release = () => db.prepare("UPDATE cover_media SET scene_status = '' WHERE id = ? AND scene_status = 'working'").bind(rowId).run();
  const model = (await loadSelection(db)).photo_scene!;
  const fail = async () => void (await db.prepare("UPDATE cover_media SET scene_status = 'failed', scene_model = ? WHERE id = ?").bind(model, rowId).run());
  const obj = await env.MEDIA.get(row.r2_key);
  if (!obj) return fail();
  let bytes: Uint8Array = new Uint8Array(await new Response(obj.body).arrayBuffer());
  let type = obj.httpMetadata?.contentType ?? "image/jpeg";
  // 太大的照片先縮小再送（省額度、避免超過模型上限）；沒有縮圖綁定就只能略過太大的。
  ({ bytes, type } = await prepareVisionImage(env, bytes, type, 1024));
  if (!bytes.length || bytes.length > MAX_BYTES) return fail();
  let est = 0;
  try {
    est = await reserveAi(db, model, { inputTokens: 1800, outputTokens: 120 });
  } catch (e) {
    await release();
    throw e;
  }
  const prompt = "請看這張照片，用繁體中文列出照片裡的「場景、人物正在做的事（行為）、看得到的主要物品」，用逗號分隔的短詞，最多 12 個，每個詞不超過 6 個字。例如：室內，講師，白板，聽講，筆記本。只回標籤，不要解釋、不要編號。";
  let out = "";
  try {
    const dataUri = `data:${type};base64,${toBase64(bytes)}`;
    const res = (await env.AI.run(model as never, { messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUri } }] }], max_tokens: 200 } as never)) as { response?: unknown; choices?: { message?: { content?: string } }[] };
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
  const scene = cleanScene(out);
  if (!scene) return fail();
  await db.prepare("UPDATE cover_media SET scene_text = ?, scene_status = 'done', scene_model = ? WHERE id = ?").bind(scene, model, rowId).run();
}

/** 還沒辨識場景的相簿照片編號（區塊照片；批次排程 ai-batch.ts 用）。 */
export async function sceneIds(db: D1Database, limit: number): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT cm.id FROM cover_media cm WHERE cm.owner_kind = 'course' AND cm.kind = 'image' AND (cm.scene_status = '' OR (cm.scene_status = 'working' AND cm.scene_at < ?)) AND EXISTS (SELECT 1 FROM lessons l WHERE l.id = cm.owner_key AND l.kind = 'section') ORDER BY cm.created_at DESC LIMIT ?")
    .bind(new Date(Date.now() - 10 * 60_000).toISOString(), limit)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

/** 背景處理還沒辨識的相簿照片（區塊照片；每次最多 limit 張；額度用完或沒綁定 AI 就停）。 */
export async function scenePending(env: Env, db: D1Database, limit = 3): Promise<void> {
  if (!env.AI) return;
  const { results } = await db
    .prepare("SELECT cm.id FROM cover_media cm WHERE cm.owner_kind = 'course' AND cm.kind = 'image' AND (cm.scene_status = '' OR (cm.scene_status = 'working' AND cm.scene_at < ?)) AND EXISTS (SELECT 1 FROM lessons l WHERE l.id = cm.owner_key AND l.kind = 'section') ORDER BY cm.created_at DESC LIMIT ?")
    .bind(new Date(Date.now() - 10 * 60_000).toISOString(), limit)
    .all<{ id: string }>();
  for (const r of results) {
    try {
      await sceneImage(env, db, r.id);
    } catch (e) {
      if (e instanceof AiStopped) return;
    }
  }
}
