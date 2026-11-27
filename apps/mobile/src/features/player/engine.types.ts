import type { Playback } from "@/api/client";

export type TrackMode = "audio" | "video" | "youtube";

/**
 * 一個「正在播放或準備播放」的章節。key 相同且 fp（內容指紋）相同＝同一堂，回到課程頁不會重新載入；
 * key 相同但 fp 不同（章節被編輯過時間軸、換了影片來源）＝要重新載入。
 */
export type Track = {
  key: string;
  /** 內容指紋：來源種類＋影片編號或網址（去掉會變的簽章參數）＋起訖秒數。 */
  fp: string;
  courseId: string;
  lessonId: string;
  title: string;
  subtitle: string;
  mode: TrackMode;
  playback: Playback;
  /** 通知欄播放器的圖片：課程 EDM（沒有就用封面）。純音檔另外優先用音檔內嵌的專輯封面。 */
  artwork: string | null;
};

export type Snapshot = {
  track: Track | null;
  playing: boolean;
  /** 目前播放位置（秒，影片本身的時間）。 */
  position: number;
  duration: number;
  loading: boolean;
  error: string | null;
  /** 這一段（時間軸區間或整支）播放完畢。 */
  segmentEnded: boolean;
  /** 目前顯示在課程頁上的播放區塊屬於哪一個 track（沒有＝已離開課程頁，進入迷你播放器模式）。 */
  slotKey: string | null;
  /** 迷你播放器縮成小圓圖（播放中會旋轉）。換播另一堂時會恢復。 */
  collapsed: boolean;
  /** 目前顯示的圖片（課程 EDM；純音檔有內嵌專輯封面時用封面）。 */
  artworkUrl: string | null;
  /** 最近一次「該顯示影片操作提示」的時間（毫秒）；進入影片、觸摸影片、拖曳時間軸時更新。 */
  hintAt: number;
  /** 正在從這一堂換到同一門課的另一堂（使用者在上課頁點了章節清單）：換好之前不顯示迷你播放器，也不再詢問。 */
  switching: boolean;
  /** 目前的播放倍數（1＝正常；可切換 1.2／1.5／1.8／2）。換課、關閉播放後仍沿用。 */
  rate: number;
  /** 每次真正載入一支影片就加 1：用來分辨「這一次載入」，避免舊的非同步回呼、舊的 iframe 訊息影響新的一堂。 */
  loadId: number;
};

export const EMPTY: Snapshot = { track: null, playing: false, position: 0, duration: 0, loading: false, error: null, segmentEnded: false, slotKey: null, collapsed: false, artworkUrl: null, hintAt: 0, switching: false, rate: 1, loadId: 0 };

// 倍數檔位、時間文字：搬到共用元件 features/player/time-format.ts（杜杜龍 2026-11-27，與繳作業系統共用播放控制列）。
export { RATES, nextRate, rateText, remainingText, formatClock } from "@/features/player/time-format";

export const trackMode = (p: Playback): TrackMode => (p.kind === "youtube" ? "youtube" : p.kind === "audio" ? "audio" : "video");

/** 內容指紋：同一堂的播放內容沒變就相同（Mux 的簽章網址每次都不同，所以只看網址路徑）。 */
export const playbackFingerprint = (p: Playback): string => `${p.kind}|${p.kind === "youtube" ? p.videoId : p.url.split("?")[0]}|${p.start ?? ""}|${p.end ?? ""}`;

export function buildTrack(p: Playback, meta: { courseId: string; lessonId: string; title: string; subtitle: string; artwork: string | null }): Track {
  return { key: `${meta.courseId}:${meta.lessonId}`, fp: playbackFingerprint(p), ...meta, mode: trackMode(p), playback: p };
}

/** 這一堂的時間軸區間（秒）。 */
export const segmentOf = (t: Track): { start: number; end: number | null } => ({ start: t.playback.start ?? 0, end: t.playback.end ?? null });
/** 開始播放的秒數：有續播記憶（resumeAt）就從那裡接著播，否則從這一堂的起點。 */
export const resumeOf = (t: Track): number => t.playback.resumeAt ?? segmentOf(t).start;



