/**
 * 網頁版圖片處理（在管理員的瀏覽器內完成，伺服器只收處理好的圖）：
 * 讀取 JPG／PNG／WebP／HEIC → 裁切 → 依長邊壓縮。上傳後不保留原始檔。
 */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const EDM_MAX_SIDE = 2048; // EDM 原圖（小字與 QR code 要看得清楚）
export const COVER_MAX_SIDE = 1024; // 16:9 封面（課程清單縮圖）長邊

export type Rect = { x: number; y: number; w: number; h: number };

const isHeic = (f: File) => /^image\/hei[cf]$/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);

/** 讀入圖片檔（含 iPhone 的 HEIC，轉成 JPEG 再讀）。 */
export async function loadImage(file: File): Promise<HTMLImageElement> {
  if (file.size > MAX_INPUT_BYTES) throw Error("圖片大小需在 20MB 以內");
  let blob: Blob = file;
  if (isHeic(file)) {
    try {
      const { default: heic2any } = await import("heic2any");
      const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
      blob = Array.isArray(out) ? out[0] : out;
    } catch {
      throw Error("無法讀取這張 HEIC 圖片，請改用 JPG 或 PNG");
    }
  } else if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    throw Error("請選擇 JPG、PNG、WebP 或 HEIC 圖片");
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(Error("無法讀取這張圖片，請換一張"));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export async function loadImageUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(Error("底圖載入失敗"));
    img.src = url;
  });
}

const toBlob = (c: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(Error("圖片處理失敗"))), "image/jpeg", quality));

function canvasOf(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff"; // PNG 透明處墊白，避免變黑
  ctx.fillRect(0, 0, w, h);
  return { c, ctx };
}

/** 取圖片的 crop 區域（原圖像素；null＝整張），等比縮到長邊不超過 maxSide，輸出 JPEG。 */
export async function cropCompress(img: HTMLImageElement, crop: Rect | null, maxSide: number, quality = 0.9): Promise<Blob> {
  const src = crop ?? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  const s = Math.min(1, maxSide / Math.max(src.w, src.h));
  const { c, ctx } = canvasOf(Math.max(1, Math.round(src.w * s)), Math.max(1, Math.round(src.h * s)));
  ctx.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, c.width, c.height);
  return toBlob(c, quality);
}

/** 背景模糊強度：把照片縮到 1/N 再放大回來（N 越大越模糊）。數字越大越模糊：6＝輕度、12＝中度、18＝偏重（杜杜龍 2026-11-15 指定 18）。不依賴 ctx.filter，iOS Safari 也能用。 */
let bgBlurDownscale = 18;
/** 由「設定 > APP 數值設定」帶入（UiConfigProvider 載入設定時呼叫）。 */
export const setBgBlurDownscale = (n: number) => void (bgBlurDownscale = n);

/** 照片比 16:9 窄多少：回傳「裁成 16:9 會切掉上下幾 %」（照片比 16:9 寬或一樣寬回 0）。 */
export function cutPercentFor16x9(img: { naturalWidth: number; naturalHeight: number }): number {
  const kept = ((img.naturalWidth / img.naturalHeight) * 9) / 16; // 裁成 16:9 後保留的高度比例
  return kept >= 1 ? 0 : Math.round((1 - kept) * 100);
}

/**
 * 「完整顯示」封面：16:9 畫布，整張照片等比縮小放在正中間（完全不裁切），
 * 背景用同一張照片鋪滿再輕度模糊、略微變暗，讓前景突出又保留照片的氛圍。
 */
export async function composeContain(img: HTMLImageElement, maxSide: number, quality = 0.88): Promise<Blob> {
  const W = Math.min(maxSide, 1280);
  const H = Math.round((W * 9) / 16);
  const { c, ctx } = canvasOf(W, H);
  // 背景：cover 鋪滿 → 縮小再放大＝輕度模糊
  const cover = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const bw = img.naturalWidth * cover;
  const bh = img.naturalHeight * cover;
  const small = document.createElement("canvas");
  small.width = Math.max(2, Math.round(W / bgBlurDownscale));
  small.height = Math.max(2, Math.round(H / bgBlurDownscale));
  const sctx = small.getContext("2d")!;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(img, (small.width - (bw * small.width) / W) / 2, (small.height - (bh * small.height) / H) / 2, (bw * small.width) / W, (bh * small.height) / H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.14)";
  ctx.fillRect(0, 0, W, H);
  // 前景：contain 置中，邊緣極淡陰影
  const fit = Math.min(W / img.naturalWidth, H / img.naturalHeight);
  const fw = Math.round(img.naturalWidth * fit);
  const fh = Math.round(img.naturalHeight * fit);
  const fx = Math.round((W - fw) / 2);
  const fy = Math.round((H - fh) / 2);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = Math.round(W / 60);
  ctx.drawImage(img, fx, fy, fw, fh);
  ctx.restore();
  return toBlob(c, quality);
}
