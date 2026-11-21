import type { CoverMediaItem, CoverMediaKind } from "@/api/client";
import { useApi } from "@/state/session";

/** 封面輪播與相簿（業主 2026-11-21）：中心、系列、課程共用的照片與短影音清單（key＝中心名稱／系列名稱／課程編號）。沒有 key 就不讀。 */
export function useCoverMedia(kind: CoverMediaKind, key: string | null | undefined) {
  const r = useApi<CoverMediaItem[]>(key ? `/cover-media?kind=${kind}&key=${encodeURIComponent(key)}` : null);
  return { items: r.data ?? [], loading: r.loading && !r.data, reload: r.reload };
}

/** 直式照片：寬高都知道、而且明顯比較高（尺寸未知的當橫式）。 */
export const isPortrait = (x: CoverMediaItem) => x.kind === "image" && x.width > 0 && x.height > x.width * 1.05;

export type CoverSlide = { key: string; items: CoverMediaItem[] };
/**
 * 輪播要顯示的「張」（業主 2026-11-21）：橫式照片與影片一張一張放；連續的直式照片三張併成一張橫式畫面，
 * 不足三張時先用相簿裡別的直式照片補（盡量不同張），真的湊不到三張不同的才重複。
 */
export function buildSlides(items: CoverMediaItem[]): CoverSlide[] {
  const portraits = items.filter(isPortrait);
  const out: CoverSlide[] = [];
  let i = 0;
  while (i < items.length) {
    const it = items[i]!;
    if (!isPortrait(it)) {
      out.push({ key: it.id, items: [it] });
      i++;
      continue;
    }
    const run: CoverMediaItem[] = [];
    while (i < items.length && isPortrait(items[i]!)) run.push(items[i++]!);
    for (let k = 0; k < run.length; k += 3) {
      const chunk = run.slice(k, k + 3);
      if (chunk.length < 3) {
        const others = portraits.filter((p) => !chunk.includes(p));
        // 從這一組後面接著找，沒有不同的就重複
        for (let n = 0; chunk.length < 3; n++) chunk.push(others.length ? others[n % others.length]! : chunk[n % chunk.length]!);
      }
      out.push({ key: chunk.map((x) => x.id).join("+") + `#${k}`, items: chunk });
    }
  }
  return out;
}
