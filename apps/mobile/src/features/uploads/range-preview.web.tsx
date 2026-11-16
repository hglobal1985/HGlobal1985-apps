import { useEffect, useMemo, useRef } from "react";
import type { MediaType } from "@/api/client";

/**
 * 時間軸預覽（網頁版）：拖到哪一秒，這裡就停在哪一秒的畫面（YouTube）或聲音位置（音檔，可按播放試聽）。
 * 拖曳中每 0.25 秒才跳一次，避免一直重新載入。
 */
export function RangePreview({ kind, ytId, audioFile, at }: { kind: MediaType; ytId: string | null; audioFile: Blob | null; at: number }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const loaded = useRef(false);
  const first = useRef(at);
  const audioUrl = useMemo(() => (audioFile ? URL.createObjectURL(audioFile) : null), [audioFile]);
  useEffect(() => () => void (audioUrl && URL.revokeObjectURL(audioUrl)), [audioUrl]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (kind === "youtube" && loaded.current) {
        const send = (func: string, args: unknown[]) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
        send("seekTo", [at, true]);
        send("pauseVideo", []);
      } else if (audio.current) audio.current.currentTime = at;
    }, 250);
    return () => clearTimeout(t);
  }, [at, kind]);
  if (kind === "youtube" && ytId)
    return (
      <div style={{ position: "relative", width: "100%", maxWidth: 260, margin: "0 auto", aspectRatio: "16 / 9", borderRadius: 10, overflow: "hidden", background: "#000" }}>
        <iframe
          ref={frame}
          title="影片預覽"
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(ytId)}?enablejsapi=1&playsinline=1&controls=0&rel=0&modestbranding=1&start=${Math.floor(first.current)}&origin=${encodeURIComponent(location.origin)}`}
          allow="autoplay; encrypted-media"
          onLoad={() => {
            loaded.current = true;
            frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
          }}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, pointerEvents: "none" }}
        />
      </div>
    );
  if (kind === "audio" && audioUrl) return <audio ref={audio} src={audioUrl} controls style={{ width: "100%" }} />;
  return null;
}
