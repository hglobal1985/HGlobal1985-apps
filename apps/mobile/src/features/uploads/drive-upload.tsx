import { NoticeBox } from "@/ui";

/** App 版暫不提供雲端硬碟上傳（請用網頁版）。 */
export function DriveUpload(_props: { maxBytes: number; onDone: () => void }) {
  return <NoticeBox text="上傳到雲端硬碟目前只能用網頁版（用手機瀏覽器開 learn.hglobal1985.com 即可）。" />;
}
