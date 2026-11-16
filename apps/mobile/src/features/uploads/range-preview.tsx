import type { MediaType } from "@/api/client";

/** iOS／Android：沒有預覽視窗（只有網頁版有）；拖曳時間軸與微調按鈕照常可用。 */
export function RangePreview(_props: { kind: MediaType; ytId: string | null; audioFile: Blob | null; at: number }) {
  return null;
}
