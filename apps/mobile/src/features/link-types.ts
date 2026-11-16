import type { Attachment } from "@/api/client";
import type { IconName } from "@/ui";

/** 外部連結類型的圖示與說明文字（其他教材清單與新增面板用；類型由連結的網域判斷，畫面另用官方 Logo）。 */
export const TYPE_INFO: Record<Attachment["type"], { icon: IconName; label: string }> = {
  youtube: { icon: "logo-youtube", label: "YouTube 影片" },
  vimeo: { icon: "logo-vimeo", label: "Vimeo 影片" },
  canva: { icon: "color-palette-outline", label: "Canva 簡報" },
  google_slides: { icon: "easel-outline", label: "Google 簡報" },
  google_docs: { icon: "document-text-outline", label: "Google 文件" },
  google_sheets: { icon: "grid-outline", label: "Google 試算表" },
  google_forms: { icon: "clipboard-outline", label: "Google 表單" },
  google_drive: { icon: "logo-google", label: "Google 雲端硬碟" },
  notion: { icon: "book-outline", label: "Notion 頁面" },
  web: { icon: "globe-outline", label: "網頁連結" },
  pdf: { icon: "document-text", label: "PDF" },
  word: { icon: "document-outline", label: "Word" },
  ppt: { icon: "easel-outline", label: "PowerPoint" },
  excel: { icon: "grid-outline", label: "Excel／CSV" },
  zip: { icon: "archive-outline", label: "壓縮檔" },
  image: { icon: "image-outline", label: "圖片" },
  text: { icon: "reader-outline", label: "文字檔" },
  file: { icon: "document-attach-outline", label: "檔案" },
};
