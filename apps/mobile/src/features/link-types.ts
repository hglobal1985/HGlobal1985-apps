import type { Attachment } from "@/api/client";
import type { IconName } from "@/ui";
import { LINK_TYPES } from "../../../launch/src/link-rules";

/** 外部連結類型的圖示與說明文字（其他教材清單與新增面板用；類型由連結的網域判斷，畫面另用官方 Logo）。 */
const ICONS: Record<Attachment["type"], IconName> = {
  youtube: "logo-youtube",
  vimeo: "logo-vimeo",
  canva: "color-palette-outline",
  google_slides: "easel-outline",
  google_docs: "document-text-outline",
  google_sheets: "grid-outline",
  google_forms: "clipboard-outline",
  google_drive: "logo-google",
  notion: "book-outline",
  web: "globe-outline",
  pdf: "document-text",
  word: "document-outline",
  ppt: "easel-outline",
  excel: "grid-outline",
  zip: "archive-outline",
  image: "image-outline",
  text: "reader-outline",
  file: "document-attach-outline",
};

/** 類型的圖示（通用圖示，畫面優先用官方 Logo）與文字（文字來自 link-rules.ts 的 LINK_TYPES，業主 2026-11-18：規則集中一處）。 */
export const TYPE_INFO = Object.fromEntries(Object.entries(ICONS).map(([k, icon]) => [k, { icon, label: LINK_TYPES[k as Attachment["type"]].label }])) as Record<Attachment["type"], { icon: IconName; label: string }>;
