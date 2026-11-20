import { PixelRatio } from "react-native";
import { useUiConfig } from "@/state/ui-config";

/**
 * Cloudflare 即時縮圖（業主 2026-11-20，小範圍試用）：手機寬度（<600）的小卡縮圖改要「縮小版」，
 * 伺服器沒開、縮不了就自動回原圖。判斷與挑尺寸只在這裡；設定在「設定 › Cloudflare即時縮圖」。
 */
export function useThumb(): (url: string, cssWidth: number) => string {
  const { config } = useUiConfig();
  const t = config.app.thumb;
  return (url, cssWidth) => {
    if (!t?.enabled || !url.includes("/media/pub") || /[?&]w=/.test(url)) return url;
    const need = cssWidth * Math.min(PixelRatio.get(), 2);
    // 手機用設定頁勾選的尺寸；平板、電腦的大圖再加 1280、1600（業主 2026-11-20，後端固定允許）。
    const sorted = [...new Set([...t.widths, 1280, 1600])].sort((a, b) => a - b);
    const w = sorted.find((x) => x >= need) ?? sorted[sorted.length - 1];
    return w ? `${url}${url.includes("?") ? "&" : "?"}w=${w}&r=3` : url; // r＝縮圖版本，改版時加一，避開手機瀏覽器裡舊的快取
  };
}

/**
 * 有透明背景的圖（品牌 logo、PNG）專用（業主 2026-11-20）：縮圖格式是 JPEG 會失去透明，所以只有在設定頁把格式選成 WebP／AVIF／PNG（保留透明）時才縮，
 * 否則維持原圖。其餘規則同 useThumb。
 */
export function useThumbAlpha(): (url: string, cssWidth: number) => string {
  const { config } = useUiConfig();
  const thumb = useThumb();
  const f = config.app.thumb?.format;
  return (url, cssWidth) => (f === "webp" || f === "avif" || f === "png" ? thumb(url, cssWidth) : url);
}
