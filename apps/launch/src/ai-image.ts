import type { Env } from "./d1.ts";

/**
 * 送給 AI 視覺模型前先把圖片整理好（杜杜龍 2026-11-26 回報 EDM 辨識一直 0 張）：
 * 站內圖片現在存成 AVIF／WebP，但 Workers AI 的視覺模型讀不了 AVIF（回「corrupt image data」），所以非 JPEG／PNG 一律先轉成 JPEG；
 * 太大的 JPEG／PNG 也縮到指定邊長（省額度）。轉不了就回原圖（由呼叫端照原本流程處理）。
 */
export async function prepareVisionImage(env: Env, bytes: Uint8Array, type: string, width: number): Promise<{ bytes: Uint8Array; type: string }> {
  const plain = /^image\/(jpeg|png)$/.test(type);
  if ((plain && bytes.length <= 1024 * 1024) || !env.IMAGES) return { bytes, type };
  try {
    const out = await env.IMAGES.input(new Blob([bytes as BlobPart]).stream()).transform({ width, fit: "scale-down" }).output({ format: "image/jpeg", quality: 85 });
    return { bytes: new Uint8Array(await out.response().arrayBuffer()), type: "image/jpeg" };
  } catch {
    return { bytes, type };
  }
}

/**
 * 取出 AI 回的文字。Llama 4 Scout 這類模型在要求 JSON 時，`response` 會直接是「已解析的物件」而不是字串（杜杜龍 2026-11-26 回報 EDM 一直 0 張的真正原因：
 * 物件被當字串處理而丟出錯誤，辨識卡在「處理中」，點數卻已扣掉）。物件一律轉回 JSON 字串，讓後面的解析照舊。
 */
export function aiResponseText(res: { response?: unknown; choices?: { message?: { content?: unknown } }[] } | null | undefined): string {
  const pick = (v: unknown): string => (typeof v === "string" ? v : v && typeof v === "object" ? JSON.stringify(v) : "");
  return pick(res?.response) || pick(res?.choices?.[0]?.message?.content);
}
