import type { Env } from "./d1.ts";
import { loadConfig } from "./ui-config.ts";

/**
 * 圖片存進 R2 之前一律先壓縮（業主 2026-11-20）：設定在「設定 › 儲存空間管理 › 圖片壓縮」。
 * 瀏覽器上傳前已先壓縮；這裡是伺服器端的最後關卡，涵蓋所有走伺服器存圖的地方（雲端硬碟匯入、匯入工作、舊版／其他管道）。
 * 不保留原圖：存的就是壓縮後的版本，使用者下載到的也是它。任何失敗都照原樣存（不擋上傳）。
 */
export type ImageClass = "center" | "edm" | "general";
const TYPES: Record<string, "jpeg" | "png" | "webp"> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };

export async function shrinkImage(env: Env, data: ArrayBuffer, type: string, cls: ImageClass): Promise<{ data: ArrayBuffer; type: string; size: number }> {
  const same = { data, type, size: data.byteLength };
  const fmt = TYPES[type];
  if (!fmt || !env.IMAGES?.info) return same;
  try {
    const app = (await loadConfig(env.DB)).app;
    const side = cls === "center" ? app.centerMaxSide : cls === "edm" ? app.edmMaxSide : app.imageMaxSide;
    const quality = cls === "center" ? app.centerQuality : cls === "edm" ? app.edmQuality : app.imageQuality;
    const info = await env.IMAGES.info(new Response(data).body!);
    const longSide = Math.max(info.width ?? 0, info.height ?? 0);
    // 已在瀏覽器壓縮過（長邊在上限內、不是未壓縮的 PNG 以外）就不重複壓縮，避免畫質再損失一次。
    if (longSide > 0 && longSide <= side && fmt !== "png") return same;
    if (longSide > 0 && longSide <= side && fmt === "png" && data.byteLength < 1024 * 1024) return same;
    const out = await env.IMAGES.input(new Response(data).body!).transform({ width: side, height: side, fit: "scale-down" }).output({ format: `image/${fmt}`, ...(fmt === "png" ? {} : { quality }) });
    const buf = await out.response().arrayBuffer();
    return buf.byteLength > 0 && buf.byteLength < data.byteLength ? { data: buf, type, size: buf.byteLength } : same;
  } catch (e) {
    console.log("shrink_failed", e instanceof Error ? e.message : String(e));
    return same;
  }
}

/** 已經存進 R2 的圖片（例如從雲端硬碟串流存入）：讀回來壓縮再覆蓋；太大（>40MB）或失敗就維持原樣。回傳最後大小。 */
export async function shrinkStored(env: Env, key: string, type: string, cls: ImageClass = "general"): Promise<number | null> {
  const bucket = env.MEDIA;
  if (!bucket || !TYPES[type]) return null;
  const head = await bucket.head(key);
  if (!head || head.size > 40 * 1024 * 1024) return null;
  const obj = await bucket.get(key);
  if (!obj) return null;
  const r = await shrinkImage(env, await new Response(obj.body).arrayBuffer(), type, cls);
  if (r.size >= head.size) return null;
  await bucket.put(key, r.data, { httpMetadata: { contentType: r.type } });
  return r.size;
}
