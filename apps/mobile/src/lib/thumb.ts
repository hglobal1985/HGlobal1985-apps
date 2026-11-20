import { PixelRatio, Dimensions } from "react-native";
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
    if (Dimensions.get("window").width >= 600) return url;
    const need = cssWidth * Math.min(PixelRatio.get(), 2);
    const sorted = [...t.widths].sort((a, b) => a - b);
    const w = sorted.find((x) => x >= need) ?? sorted[sorted.length - 1];
    return w ? `${url}${url.includes("?") ? "&" : "?"}w=${w}&r=2` : url; // r＝縮圖版本，改版時加一，避開手機瀏覽器裡舊的快取
  };
}
