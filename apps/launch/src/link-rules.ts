/**
 * 外部連結「自動判斷類型」的唯一規則來源（杜杜龍 2026-11-18：模組化，之後可能再改）。
 * 後端（儲存教材時判斷、預設名稱）與 App（圖示、類型文字）共用這一個檔案；要新增或調整類型：
 * ① 在 `AttachmentType`（contract.ts）加一種類型 ② 在這裡的 `LINK_TYPES` 加名稱 ③ 在 `LINK_RULES` 加判斷規則（由上往下，第一個符合的就用）
 * ④ App 端在 `lib/brand-icons.ts` 加官方圖形（沒有就用 `features/link-types.ts` 的通用圖示）。
 * 只看網域與路徑，不連線。
 */
import type { AttachmentType } from "./contract.ts";

/** 每種類型的顯示名稱（label：類型文字）與預設教材名稱（defaultTitle：抓不到網頁標題時用）。 */
export const LINK_TYPES: Record<AttachmentType, { label: string; defaultTitle: string }> = {
  youtube: { label: "YouTube 影片", defaultTitle: "YouTube 影片" },
  vimeo: { label: "Vimeo 影片", defaultTitle: "Vimeo 影片" },
  canva: { label: "Canva 簡報", defaultTitle: "Canva 簡報" },
  google_slides: { label: "Google 簡報", defaultTitle: "Google 簡報" },
  google_docs: { label: "Google 文件", defaultTitle: "Google 文件" },
  google_sheets: { label: "Google 試算表", defaultTitle: "Google 試算表" },
  google_forms: { label: "Google 表單", defaultTitle: "Google 表單" },
  google_drive: { label: "Google 雲端硬碟", defaultTitle: "Google 雲端硬碟" },
  notion: { label: "Notion 頁面", defaultTitle: "Notion 頁面" },
  web: { label: "網頁連結", defaultTitle: "網頁連結" },
  pdf: { label: "PDF", defaultTitle: "PDF 文件" },
  word: { label: "Word", defaultTitle: "Word 文件" },
  ppt: { label: "PowerPoint", defaultTitle: "PowerPoint 簡報" },
  excel: { label: "Excel／CSV", defaultTitle: "Excel 試算表" },
  zip: { label: "壓縮檔", defaultTitle: "壓縮檔" },
  image: { label: "圖片", defaultTitle: "圖片" },
  text: { label: "文字檔", defaultTitle: "文字檔" },
  file: { label: "檔案", defaultTitle: "檔案" },
};

/**
 * 判斷規則（由上往下，第一個符合就用）：
 * - hosts：網域（含子網域）完全符合其一；exact：只比對完全相同的網域（不含子網域）
 * - pathStarts：路徑開頭；pathEnds：路徑結尾
 * 同時有多個條件時，要全部符合。
 */
export type LinkRule = { type: AttachmentType; hosts?: string[]; exact?: string[]; pathStarts?: string[]; pathEnds?: string[] };
export const LINK_RULES: LinkRule[] = [
  { type: "youtube", hosts: ["youtube.com", "youtube-nocookie.com"] },
  { type: "youtube", exact: ["youtu.be"] },
  { type: "vimeo", hosts: ["vimeo.com"] },
  { type: "canva", hosts: ["canva.com"] },
  { type: "canva", exact: ["canva.link"] },
  { type: "google_slides", exact: ["docs.google.com"], pathStarts: ["/presentation"] },
  { type: "google_docs", exact: ["docs.google.com"], pathStarts: ["/document"] },
  { type: "google_sheets", exact: ["docs.google.com"], pathStarts: ["/spreadsheets"] },
  { type: "google_forms", exact: ["docs.google.com"], pathStarts: ["/forms"] },
  { type: "google_forms", exact: ["forms.gle"] },
  { type: "google_drive", exact: ["drive.google.com"] },
  { type: "notion", hosts: ["notion.so", "notion.site"] },
  { type: "pdf", pathEnds: [".pdf"] },
];
/** 都不符合時的類型（docs.google.com 的其他路徑也是它）。 */
export const LINK_FALLBACK: AttachmentType = "web";

/** 依網址判斷類型。 */
export function classifyUrl(u: { hostname: string; pathname: string }): AttachmentType {
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.toLowerCase();
  for (const r of LINK_RULES) {
    if (r.hosts && !r.hosts.some((d) => host === d || host.endsWith(`.${d}`))) continue;
    if (r.exact && !r.exact.includes(host)) continue;
    if (r.pathStarts && !r.pathStarts.some((p) => path.startsWith(p))) continue;
    if (r.pathEnds && !r.pathEnds.some((p) => path.endsWith(p))) continue;
    return r.type;
  }
  return LINK_FALLBACK;
}

/** 清單項目的圖示類型：外部連結用連結類型；清單裡貼的 YouTube 影片（存成影片來源）也是 YouTube；其餘沒有。 */
export function itemIconType(linkType: AttachmentType | undefined, mediaType: string | null | undefined, isList: boolean): AttachmentType | undefined {
  if (linkType) return linkType;
  return isList && mediaType === "youtube" ? "youtube" : undefined;
}
