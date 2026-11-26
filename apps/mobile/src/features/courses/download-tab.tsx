import type { CourseDetail, Lesson } from "@/api/client";
import { Card } from "@/ui";
import { LIST_CARD } from "./compact-row";
import { MaterialRow } from "./material-rows";

/**
 * 「下載」分類標籤【共用模組】（杜杜龍 2026-11-26，全站設定）：課程卡、清單卡、系列頁展開內容、至尊模式課程頁都用這一份。
 * 規則：只要這張卡有「影片以外」的教材——上傳的檔案或外部連結（PDF、PPT、Word、Excel、圖片、Google 雲端硬碟／文件／簡報、Canva、Notion、一般網頁…）——
 * 就多一個「下載」標籤，把這些教材同步列在裡面（原本的位置照舊、不搬走）；一個都沒有就不出現。YouTube／Vimeo 連結算影片，不算。
 * 要改「什麼算下載」只改 `isDownloadItem`；要改標籤名稱只改 `DOWNLOAD_TAB`。
 */
export const DOWNLOAD_TAB = { key: "download" as const, label: "下載" };

/** 影片以外的教材：有連結或檔案、不是 YouTube／Vimeo、不是區塊標題、不是「完整版課程影片」。 */
export const isDownloadItem = (l: Lesson): boolean => !!l.material && !l.section && !l.full && !!l.linkType && l.linkType !== "youtube" && l.linkType !== "vimeo";

/** 這張卡「下載」標籤裡的教材（學員只看得到有內容的；管理者全部）；日期新到舊，同日維持原順序，沒有日期的放最後。 */
export function downloadItems(course: CourseDetail): Lesson[] {
  const edit = !!course.can?.edit;
  return course.lessons
    .filter((l) => isDownloadItem(l) && (l.ready || edit || !!l.linkUrl))
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (b.l.eventDate ?? "").localeCompare(a.l.eventDate ?? "") || a.i - b.i)
    .map((x) => x.l);
}

/** 「下載」標籤的內容：所有影片以外的教材排成一張卡，每列＝教材列模組（點了開啟連結或下載、右側加入清單與分享）。 */
export function DownloadList({ course, onBlockedPress }: { course: CourseDetail; onBlockedPress?: () => void }) {
  const items = downloadItems(course);
  if (!items.length) return null;
  return (
    <Card style={LIST_CARD}>
      {items.map((l) => (
        <MaterialRow key={l.id} course={course} lesson={l} listStyle onBlockedPress={onBlockedPress} />
      ))}
    </Card>
  );
}
