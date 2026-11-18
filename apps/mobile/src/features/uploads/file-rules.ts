/**
 * 教材檔案上傳的共用規則（業主 2026-11-18）：圖片、照片、文件可以；影片不行；單檔最大 30MB。
 * 後端（apps/launch/src/files.ts）有同一套規則，這裡是上傳前先擋，讓使用者立刻看到提示。
 */
export const FILE_MAX_BYTES = 30 * 1024 * 1024;
export const FILE_TOO_BIG = "檔案超過 30MB。請上傳到其他雲端空間後再將連結複製貼上到這裡";
export const FILE_NO_VIDEO = "不能上傳影片檔。請先把影片上傳到 YouTube 或其他雲端空間，再將連結複製貼上到這裡";
export const FILE_BAD_TYPE = "這種檔案格式不支援。可上傳圖片、PDF、Word、PowerPoint、Excel、文字檔；其他格式請上傳到雲端空間後貼連結";
/** 選檔視窗接受的格式（瀏覽器 accept 屬性）。 */
export const FILE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.pdf,.doc,.docx,.rtf,.odt,.ppt,.pptx,.key,.odp,.xls,.xlsx,.csv,.ods,.txt,.md";

const VIDEO = /\.(mp4|mov|m4v|avi|mkv|webm|wmv|flv|mpg|mpeg|3gp|mts|m2ts|ogv|rm|rmvb)$/i;
const OK = /\.(jpe?g|png|webp|gif|heic|heif|pdf|docx?|rtf|odt|pptx?|key|odp|xlsx?|csv|ods|txt|md)$/i;
/** 圖片（會自動壓縮，壓縮畫素與封面相同）。 */
export const COMPRESSIBLE = /\.(jpe?g|png|webp)$/i;

/** 挑到的檔案有沒有問題；沒問題回 null。圖片壓縮前的大小不設限（壓縮後才算 30MB）。 */
export function fileProblem(name: string, type: string, bytes: number): string | null {
  if (type.startsWith("video/") || VIDEO.test(name)) return FILE_NO_VIDEO;
  if (!OK.test(name)) return FILE_BAD_TYPE;
  if (!COMPRESSIBLE.test(name) && bytes > FILE_MAX_BYTES) return FILE_TOO_BIG;
  return null;
}
