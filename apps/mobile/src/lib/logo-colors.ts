import { Platform } from "react-native";

/**
 * 從 logo 圖挑出最常用的幾種顏色（業主 2026-11-18：品牌 logo 的「指定底色」自動建議 logo 常用的最多 5 種顏色）。
 * 只有網頁版做得到（用 canvas 取樣）；透明像素不算；相近的顏色歸成一組。讀不到就回空陣列。
 */
export async function logoColors(url: string, max = 5): Promise<string[]> {
  if (Platform.OS !== "web" || typeof document === "undefined") return [];
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => {
      const i = new window.Image();
      i.crossOrigin = "anonymous";
      i.onload = () => ok(i);
      i.onerror = () => no(new Error("load"));
      i.src = url;
    });
    const w = 80;
    const h = Math.max(1, Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * w));
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d");
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3]! < 200) continue;
      const r = px[i]!, g = px[i + 1]!, b = px[i + 2]!;
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5); // 每個色版分 8 級
      const e = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += r; e.g += g; e.b += b;
      bins.set(key, e);
    }
    const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
    return [...bins.values()]
      .sort((x, y) => y.n - x.n)
      .slice(0, max)
      .map((e) => `#${hex(e.r / e.n)}${hex(e.g / e.n)}${hex(e.b / e.n)}`.toUpperCase());
  } catch {
    return [];
  }
}
