import type { AttachmentType } from "./contract.ts";

/** 教材檔案上傳（杜杜龍 2026-11-18）：圖片、照片、文件可以；影片不行；單檔最大 30MB。 */
export const FILE_MAX_BYTES = 30 * 1024 * 1024;
export const FILE_TOO_BIG = "檔案太大。請上傳到其他雲端空間後再將連結複製貼上到這裡";
export const fileTooBig = (mb: number) => `檔案超過 ${mb}MB。請上傳到其他雲端空間後再將連結複製貼上到這裡`;
export const FILE_NO_VIDEO = "不能上傳影片檔。請先把影片上傳到 YouTube 或其他雲端空間，再將連結複製貼上到這裡";

const VIDEO_EXT = /\.(mp4|mov|m4v|avi|mkv|webm|wmv|flv|mpg|mpeg|3gp|mts|m2ts|ogv|rm|rmvb)$/i;
const TYPES: { re: RegExp; type: AttachmentType; ct: string }[] = [
  { re: /\.pdf$/i, type: "pdf", ct: "application/pdf" },
  { re: /\.docx$/i, type: "word", ct: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { re: /\.doc$/i, type: "word", ct: "application/msword" },
  { re: /\.(rtf|odt)$/i, type: "word", ct: "application/octet-stream" },
  { re: /\.pptx$/i, type: "ppt", ct: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  { re: /\.ppt$/i, type: "ppt", ct: "application/vnd.ms-powerpoint" },
  { re: /\.(key|odp)$/i, type: "ppt", ct: "application/octet-stream" },
  { re: /\.xlsx$/i, type: "excel", ct: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  { re: /\.xls$/i, type: "excel", ct: "application/vnd.ms-excel" },
  { re: /\.csv$/i, type: "excel", ct: "text/csv; charset=utf-8" },
  { re: /\.ods$/i, type: "excel", ct: "application/octet-stream" },
  { re: /\.(txt|md)$/i, type: "text", ct: "text/plain; charset=utf-8" },
  { re: /\.(jpe?g)$/i, type: "image", ct: "image/jpeg" },
  { re: /\.png$/i, type: "image", ct: "image/png" },
  { re: /\.webp$/i, type: "image", ct: "image/webp" },
  { re: /\.gif$/i, type: "image", ct: "image/gif" },
  { re: /\.(heic|heif)$/i, type: "image", ct: "image/heic" },
];

export type FileKind = { type: AttachmentType; ct: string };
/** 依檔名判斷可不可以上傳：影片回 "video"，不支援的格式回 null。 */
export function classifyFile(name: string): FileKind | "video" | null {
  if (VIDEO_EXT.test(name)) return "video";
  const t = TYPES.find((x) => x.re.test(name));
  return t ? { type: t.type, ct: t.ct } : null;
}

/** 檔名整理成安全的 R2 鍵片段（保留副檔名）。 */
export function safeFileName(name: string): string {
  const base = name.replace(/[\\/]/g, "_").replace(/[^\w.\-一-鿿]+/g, "_").replace(/^\.+/, "").slice(-80);
  return base || "file";
}

/** 儲存空間統計的檔案分類。 */
export type StorageKind = "image" | "doc" | "audio" | "other";
