import { useEffect, useMemo, useRef } from "react";
import type { RangePreviewProps } from "./range-preview";

/**
 * 時間軸預覽（網頁版）：拖到哪一秒，這裡就停在哪一秒的畫面（YouTube）或聲音位置（音檔）；
 * 由上層的播放鈕控制試播，播放時紅線會跟著播放位置走，方便邊聽邊決定開始、結束的位置。
 * YouTube 沒播放過就跳秒會是黑畫面，所以每次跳秒都先「靜音播放一下再暫停」讓影格顯示出來。
 */
export function RangePreview({ kind, ytId, audioFile, at, playing, onTime, onStop }: RangePreviewProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const loaded = useRef(false);
  const first = useRef(at);
  const lastTime = useRef(at); // 播放位置最後一次回報的秒數（判斷「是播放前進」還是「使用者拖曳跳秒」）
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const cb = useRef({ onTime, onStop });
  cb.current = { onTime, onStop };
  const audioUrl = useMemo(() => (audioFile ? URL.createObjectURL(audioFile) : null), [audioFile]);
  useEffect(() => () => void (audioUrl && URL.revokeObjectURL(audioUrl)), [audioUrl]);

  const send = (func: string, args: unknown[] = []) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  /** 讓目前這一格顯示出來：靜音播放 0.4 秒再暫停（沒在試播時才做）。 */
  const reveal = () => {
    send("mute");
    send("playVideo");
    setTimeout(() => {
      if (!playingRef.current) send("pauseVideo");
    }, 400);
  };

  // 使用者拖曳／微調（紅線跟播放位置差很多）→ 跳到那一秒。
  useEffect(() => {
    if (Math.abs(at - lastTime.current) < 1.5 && playing) return;
    if (Math.abs(at - lastTime.current) < 0.5) return;
    const t = setTimeout(() => {
      lastTime.current = at;
      if (kind === "youtube" && loaded.current) {
        send("seekTo", [at, true]);
        if (!playingRef.current) reveal();
      } else if (audio.current) audio.current.currentTime = at;
    }, 250);
    return () => clearTimeout(t);
  }, [at]); // eslint-disable-line react-hooks/exhaustive-deps

  // 播放／暫停
  useEffect(() => {
    if (kind === "youtube") {
      if (!loaded.current) return;
      if (playing) {
        send("unMute");
        send("seekTo", [at, true]);
        send("playVideo");
      } else send("pauseVideo");
    } else if (audio.current) {
      if (playing) {
        audio.current.currentTime = at;
        void audio.current.play().catch(() => cb.current.onStop());
      } else audio.current.pause();
    }
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // YouTube 播放位置回報
  useEffect(() => {
    if (kind !== "youtube") return;
    const onMsg = (ev: MessageEvent) => {
      if (ev.source !== frame.current?.contentWindow || typeof ev.data !== "string") return;
      try {
        const d = JSON.parse(ev.data) as { event?: string; info?: { currentTime?: number; playerState?: number } };
        const info = d.info;
        if (d.event !== "infoDelivery" || !info) return;
        if (info.playerState === 0 && playingRef.current) cb.current.onStop();
        if (typeof info.currentTime === "number" && playingRef.current && info.playerState === 1) {
          lastTime.current = info.currentTime;
          cb.current.onTime(info.currentTime);
        }
      } catch {
        /* 非播放器訊息 */
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [kind]);

  if (kind === "youtube" && ytId)
    return (
      <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", borderRadius: 10, overflow: "hidden", background: "#000" }}>
        <iframe
          ref={frame}
          title="影片預覽"
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(ytId)}?enablejsapi=1&playsinline=1&controls=0&rel=0&modestbranding=1&start=${Math.floor(first.current)}&origin=${encodeURIComponent(location.origin)}`}
          allow="autoplay; encrypted-media"
          onLoad={() => {
            loaded.current = true;
            frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
            setTimeout(reveal, 600); // 一進來就先顯示第一格，不再是黑畫面
          }}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, pointerEvents: "none" }}
        />
      </div>
    );
  if (kind === "audio" && audioUrl)
    return (
      <audio
        ref={audio}
        src={audioUrl}
        onTimeUpdate={(e) => {
          if (!playingRef.current) return;
          lastTime.current = e.currentTarget.currentTime;
          cb.current.onTime(e.currentTarget.currentTime);
        }}
        onEnded={() => cb.current.onStop()}
        style={{ display: "none" }}
      />
    );
  return null;
}
