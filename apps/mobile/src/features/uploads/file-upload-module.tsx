import type { CourseDetail } from "@/api/client";
import { NoticeBox } from "@/ui";

/** App 版暫不提供檔案上傳（請用網頁版）。 */
export function FileUploadModule(_props: { courseId: string; onUploaded: (detail: CourseDetail, hadErrors: boolean) => void; onBusyChange?: (busy: boolean) => void }) {
  return <NoticeBox text="上傳檔案目前只能用網頁版；App 請先貼上雲端連結。" />;
}
