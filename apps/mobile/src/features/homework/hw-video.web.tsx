import { resolveUrl } from "@/api/client";

/** 作業短影片播放（網頁版）：瀏覽器內建播放器，手機上可全螢幕。 */
export function HwVideo({ url, poster }: { url: string; poster: string | null }) {
  return <video src={resolveUrl(url)} poster={poster ? resolveUrl(poster) : undefined} controls playsInline preload="metadata" style={{ width: "100%", maxHeight: 420, borderRadius: 12, background: "#000" }} />;
}
