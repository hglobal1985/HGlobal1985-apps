/** 共用元件的轉接檔：繳作業系統沒有背景播放的播放器（清單列的「播放中」圖示永遠不顯示）。 */
const IDLE: { track: { lessonId: string } | null; playing: boolean } = { track: null, playing: false };
export function usePlayer() {
  return IDLE;
}
