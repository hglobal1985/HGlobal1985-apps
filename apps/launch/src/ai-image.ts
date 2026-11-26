import type { Env } from "./d1.ts";

/**
 * 送給 AI 視覺模型前先把圖片整理好（業主 2026-11-26 回報 EDM 辨識一直 0 張）：
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
