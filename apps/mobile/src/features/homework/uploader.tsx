import type { HwAssignment, HwSubmission } from "@/api/client";
import { NoticeBox } from "@/ui";

/** App（iOS／Android）版：作業上傳先只有網頁版（照片、影片壓縮都在瀏覽器裡做，業主 2026-11-25）。 */
export function HomeworkUploader(_p: { assignment: HwAssignment; mine: HwSubmission | null; onChanged: (m: HwSubmission) => void }) {
  return <NoticeBox tone="warning" text="交作業請用手機瀏覽器打開行動大學網站（learn.hglobal1985.com）。" />;
}
