import { trackFeature } from "@/lib/feature-track";
import { useStageMax } from "@/ui/stage-frame";
import { ControlsBar } from "@/features/player/controls-bar";
import { engine } from "./engine";
import { segmentOf } from "./engine.types";
import { usePlayer } from "./use-player";

/**
 * 課程頁的播放控制列：Mux 影片、YouTube、純音檔三種「共用同一個元件」，位置在影片的外面下方（不在影片裡面）。
 * 外觀在共用元件 ControlsBar（packages/ui/src/features/player/controls-bar.tsx，與繳作業系統同一個）；這裡只接上行動大學的播放引擎。
 * 以後要改時間軸的外觀或位置，只改 controls-bar.tsx 與 seek-bar.tsx，三種模式與繳作業系統會自動一起變。
 */
export function PlayerControls({ overlay = false }: { /** 全螢幕疊在影片上：黑色半透明底、白色圖示（杜杜龍 2026-11-24）。 */ overlay?: boolean } = {}) {
  const s = usePlayer();
  const maxWidth = useStageMax(); // 與上方舞台同寬（大螢幕兩欄時填滿左欄）
  const t = s.track;
  if (!t) return null;
  const { start, end } = segmentOf(t);
  const total = Math.max(0, (end ?? s.duration) - start);
  return (
    <ControlsBar
      overlay={overlay}
      maxWidth={maxWidth}
      playing={s.playing}
      loading={s.loading}
      position={s.position - start}
      total={total}
      rate={s.rate}
      onToggle={() => engine.toggle()}
      onSeek={(v) => engine.seek(start + v)}
      onRate={() => (trackFeature("player_speed"), engine.cycleRate())}
      pip={t.mode === "video" && engine.canPip() ? { active: engine.isPip(), onPress: () => engine.togglePip() } : undefined}
      onFullscreen={t.mode !== "audio" && engine.canFullscreen() ? () => engine.toggleFullscreen() : undefined}
    />
  );
}
