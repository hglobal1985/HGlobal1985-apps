import type { CoverMediaItem, CoverMediaKind } from "@/api/client";
import { useApi } from "@/state/session";

/**
 * 封面輪播與相簿（業主 2026-11-21）：中心、系列、課程共用的照片與短影音清單（key＝中心名稱／系列名稱／課程編號）。沒有 key 就不讀。
 * 業主 2026-11-23：兩個儲存區各自獨立——cover＝封面編輯上傳的封面輪播照片；edm＝中心「EDM」分頁的照片（系列、課程只有 cover）。
 * 中心封面可以勾「封面輪播顯示 EDM」（預設打勾）：carousel＝封面照片＋（勾選時）EDM 照片，是封面實際輪播的內容。
 */
export function useCoverMedia(kind: CoverMediaKind, key: string | null | undefined) {
  const r = useApi<CoverMediaItem[]>(key ? `/cover-media?kind=${kind}&key=${encodeURIComponent(key)}` : null);
  const cfg = useApi<{ showEdm: boolean }>(key && kind === "center" ? `/cover-media/config?center=${encodeURIComponent(key)}` : null);
  const all = r.data ?? [];
  const cover = all.filter((x) => x.scope !== "edm");
  const edm = all.filter((x) => x.scope === "edm");
  const showEdm = cfg.data?.showEdm !== false;
  return { items: all, cover, edm, showEdm, carousel: showEdm ? [...cover, ...edm] : cover, loading: r.loading && !r.data, reload: () => (r.reload(), cfg.reload()) };
}

/** 橫式：寬高都知道、而且明顯比較寬（寬 ÷ 高 ≥ 1.2）；尺寸未知的也當橫式。接近 1:1 的方形照片不算橫式（業主 2026-11-23：一律三張合併）。 */
export const isLandscape = (x: CoverMediaItem) => x.kind === "image" ? x.width <= 0 || x.height <= 0 || x.width >= x.height * 1.2 : true;
/** 要三張合併的照片：不是橫式的照片（直式與接近方形）。影片不合併。 */
export const isPortrait = (x: CoverMediaItem) => x.kind === "image" && !isLandscape(x);

export type CoverSlide = { key: string; items: CoverMediaItem[] };
/**
 * 輪播要顯示的「張」（業主 2026-11-21）：橫式照片與影片一張一張放；連續的「不是橫式」照片（直式、接近方形）三張併成一張橫式畫面，
 * 不足三張時先用相簿裡別的直式照片補（盡量不同張），真的湊不到三張不同的才重複。
 */
export function buildSlides(items: CoverMediaItem[]): CoverSlide[] {
  const portraits = items.filter(isPortrait);
  const out: CoverSlide[] = [];
  let i = 0;
  while (i < items.length) {
    const it = items[i]!;
    if (!isPortrait(it)) {
      out.push({ key: `${it.id}#${out.length}`, items: [it] });
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
      out.push({ key: chunk.map((x) => x.id).join("+") + `#${out.length}`, items: chunk });
    }
  }
  return out;
}
