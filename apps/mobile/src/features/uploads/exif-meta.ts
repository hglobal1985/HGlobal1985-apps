import exifr from "exifr";

/**
 * 上傳照片時讀出原始檔的 EXIF 與檔案資訊（杜杜龍 2026-11-24，給圖片「資訊」面板用；網頁版專用）。
 * 壓縮後的圖片不含 EXIF，所以要在壓縮前從原始檔讀；讀不到就回空物件，不影響上傳。
 */
export type PhotoMeta = { exif: Record<string, unknown>; file: { name: string; type: string; bytes: number; width: number; height: number; lastModified: string } };
export async function readPhotoMeta(f: File, width: number, height: number): Promise<PhotoMeta> {
  let exif: Record<string, unknown> = {};
  try {
    const raw = ((await exifr.parse(f, ({ tiff: true, ifd0: true, exif: true, gps: true, interop: false, ifd1: false, makerNote: false, userComment: false, translateValues: true, reviveValues: true }) as never)) ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) {
      if (v == null || typeof v === "function") continue;
      if (v instanceof Date) exif[k] = v.toISOString();
      else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") exif[k] = typeof v === "string" ? v.slice(0, 200) : v;
      else if (Array.isArray(v) && v.length <= 8 && v.every((x) => typeof x === "number" || typeof x === "string")) exif[k] = v;
    }
  } catch {
    exif = {};
  }
  return { exif, file: { name: f.name.slice(0, 120), type: f.type, bytes: f.size, width, height, lastModified: f.lastModified ? new Date(f.lastModified).toISOString() : "" } };
}
