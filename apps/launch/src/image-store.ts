import type { Env } from "./d1.ts";
import { loadConfig } from "./ui-config.ts";

/**
 * 圖片存進 R2 之前一律先壓縮（業主 2026-11-20）：設定在「設定 › 儲存空間管理 › 圖片壓縮」。
 * 瀏覽器上傳前已先壓縮；這裡是伺服器端的最後關卡，涵蓋所有走伺服器存圖的地方（雲端硬碟匯入、匯入工作、舊版／其他管道）。
 * 不保留原圖：存的就是壓縮後的版本，使用者下載到的也是它。任何失敗都照原樣存（不擋上傳）。
 */
export type ImageClass = "center" | "edm" | "general";
const TYPES: Record<string, "jpeg" | "png" | "webp" | "avif"> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };

const EXT_OF: Record<string, string> = { jpeg: "jpg", webp: "webp", avif: "avif" };
/** 轉成指定格式後，檔名的副檔名也要跟著換（例如 photo.png → photo.jpg）。 */
export const renameForType = (name: string, type: string): string => {
  const ext = EXT_OF[type.replace("image/", "")];
  return ext ? name.replace(/\.[A-Za-z0-9]{2,5}$/, "") + "." + ext : name;
};

/**
 * @param keepFormat true＝不轉格式（品牌 logo：透明背景的 PNG 轉成 JPEG 會破壞深色模式底色），只縮尺寸。
 * 其他圖片固定轉成 JPEG（2026-11-25 起不再有「存檔格式」設定）；相簿照片與教材圖片由呼叫端傳 override（相簿存檔格式與畫質）。
 */
export async function shrinkImage(env: Env, data: ArrayBuffer, type: string, cls: ImageClass, keepFormat = false, override?: { format: "jpeg" | "webp" | "avif"; quality: number }): Promise<{ data: ArrayBuffer; type: string; size: number }> {
  const same = { data, type, size: data.byteLength };
  const fmt = TYPES[type];
  if (!fmt || !env.IMAGES?.info) return same;
  try {
    const app = (await loadConfig(env.DB)).app;
    const side = cls === "center" ? app.centerMaxSide : cls === "edm" ? app.edmMaxSide : app.imageMaxSide;
    const quality = override?.quality ?? (cls === "center" ? app.centerQuality : cls === "edm" ? app.edmQuality : app.imageQuality);
    // 全站圖片的存檔格式不再有獨立設定（業主 2026-11-25）：一般圖片固定 JPEG；相簿照片與教材圖片用「相簿存檔格式」（override）；品牌 logo 保留原格式。
    const target = override?.format ?? (keepFormat ? fmt : "jpeg");
    const info = await env.IMAGES.info(new Response(data).body!);
    const longSide = Math.max(info.width ?? 0, info.height ?? 0);
    // 要保留的 PNG（品牌 logo）沒有畫質參數，長邊在上限內且小於 1MB 就不動。
    if (keepFormat && target === "png" && longSide > 0 && longSide <= side && data.byteLength < 1024 * 1024) return same;
    // 透明背景的圖轉成 JPEG／WebP／AVIF 時用白色墊底（全站規則：透明圖底色一律白色）。
    const out = await env.IMAGES.input(new Response(data).body!).transform({ width: side, height: side, fit: "scale-down", ...(target === "png" ? {} : { background: "#ffffff" }) }).output({ format: `image/${target}`, ...(target === "png" ? {} : { quality }) });
    const buf = await out.response().arrayBuffer();
    if (!buf.byteLength) return same;
    // 格式有換就一律採用新檔；格式沒換時只有變小才採用。
    return target !== fmt || buf.byteLength < data.byteLength ? { data: buf, type: `image/${target}`, size: buf.byteLength } : same;
  } catch (e) {
    console.log("shrink_failed", e instanceof Error ? e.message : String(e));
    return same;
  }
}

/** 已經存進 R2 的圖片（例如從雲端硬碟串流存入）：讀回來壓縮再覆蓋；太大（>40MB）或失敗就維持原樣。回傳最後大小。 */
export async function shrinkStored(env: Env, key: string, type: string, cls: ImageClass = "general", override?: { format: "jpeg" | "webp" | "avif"; quality: number }): Promise<{ size: number; type: string } | null> {
  const bucket = env.MEDIA;
  if (!bucket || !TYPES[type]) return null;
  const head = await bucket.head(key);
  if (!head || head.size > 40 * 1024 * 1024) return null;
  const obj = await bucket.get(key);
  if (!obj) return null;
  const r = await shrinkImage(env, await new Response(obj.body).arrayBuffer(), type, cls, false, override);
  if (r.size >= head.size && r.type === type) return null;
  await bucket.put(key, r.data, { httpMetadata: { contentType: r.type } });
  return { size: r.size, type: r.type };
}
