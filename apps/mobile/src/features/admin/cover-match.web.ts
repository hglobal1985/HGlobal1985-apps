/**
 * 從 EDM 原圖裡「找出」一張既有封面是從哪裡裁出來的（只在瀏覽器執行；舊課程沒有存封面裁切框時用來補回）。
 * 做法：把兩張圖縮小成灰階，在各種縮放與位置下逐格比對差異，取差異最小的；差異太大就回 null（無法判斷，請人工重設）。
 * 回傳的是占 EDM 寬高的比例（x、y 左上角，w 寬；高由 16:9 算出）。
 */
export type FoundRect = { x: number; y: number; w: number };

function gray(img: HTMLImageElement, w: number, h: number): Float32Array {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = (d[i * 4]! * 0.299 + d[i * 4 + 1]! * 0.587 + d[i * 4 + 2]! * 0.114) / 255;
  return out;
}

type Hit = { err: number; s: number; x: number; y: number };

function scan(edm: HTMLImageElement, cover: HTMLImageElement, wd: number, scales: number[], xr: [number, number] | null, yr: [number, number] | null): Hit {
  const hd = Math.max(1, Math.round((wd * edm.naturalHeight) / edm.naturalWidth));
  const big = gray(edm, wd, hd);
  let best: Hit = { err: Infinity, s: 1, x: 0, y: 0 };
  for (const s of scales) {
    const cw = Math.max(8, Math.round(wd * s));
    const ch = Math.max(5, Math.round((cw * 9) / 16));
    if (cw > wd || ch > hd) continue;
    const small = gray(cover, cw, ch);
    const x0 = xr ? Math.max(0, xr[0]) : 0;
    const x1 = xr ? Math.min(wd - cw, xr[1]) : wd - cw;
    const y0 = yr ? Math.max(0, yr[0]) : 0;
    const y1 = yr ? Math.min(hd - ch, yr[1]) : hd - ch;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let sum = 0;
        for (let j = 0; j < ch && sum < best.err * cw * ch; j++) {
          const row = (y + j) * wd + x;
          const rs = j * cw;
          for (let i = 0; i < cw; i++) sum += Math.abs(big[row + i]! - small[rs + i]!);
        }
        const e = sum / (cw * ch);
        if (e < best.err) best = { err: e, s, x: x / wd, y: y / hd };
      }
    }
  }
  return best;
}

export function locateCover(edm: HTMLImageElement, cover: HTMLImageElement): FoundRect | null {
  // ① 粗找：96 像素寬，縮放 100%～40%
  const coarse = scan(edm, cover, 96, Array.from({ length: 13 }, (_, i) => 1 - i * 0.05), null, null);
  if (!isFinite(coarse.err) || coarse.err > 0.08) return null;
  // ② 細找：256 像素寬，在粗找結果附近
  const wd = 256;
  const hd = Math.round((wd * edm.naturalHeight) / edm.naturalWidth);
  const scales = Array.from({ length: 13 }, (_, i) => Math.min(1, coarse.s - 0.03 + i * 0.005));
  const fine = scan(edm, cover, wd, scales, [Math.round(coarse.x * wd) - 6, Math.round(coarse.x * wd) + 6], [Math.round(coarse.y * hd) - 6, Math.round(coarse.y * hd) + 6]);
  if (!isFinite(fine.err) || fine.err > 0.06) return null;
  // 接近滿版寬度就當成滿版（避免 0.99 這種小誤差）
  const full = fine.s >= 0.975;
  return full ? { x: 0, y: Math.round(fine.y * 10000) / 10000, w: 1 } : { x: Math.round(fine.x * 10000) / 10000, y: Math.round(fine.y * 10000) / 10000, w: Math.round(fine.s * 10000) / 10000 };
}
