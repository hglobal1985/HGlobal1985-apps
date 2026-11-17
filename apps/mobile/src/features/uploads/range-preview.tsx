import type { MediaType } from "@/api/client";

export type RangePreviewProps = {
  kind: MediaType;
  ytId: string | null;
  audioFile: Blob | null;
  /** 紅線目前的秒數。 */
  at: number;
  /** 是否正在試播（由按鈕控制）。 */
  playing: boolean;
  /** 試播中，播放到哪一秒（紅線跟著走）。 */
  onTime: (sec: number) => void;
  /** 播放自己結束或停住（例如到影片結尾）。 */
  onStop: () => void;
};

/** iOS／Android：沒有預覽視窗（只有網頁版有）；拖曳時間軸與微調按鈕照常可用。 */
export function RangePreview(_props: RangePreviewProps) {
  return null;
}
