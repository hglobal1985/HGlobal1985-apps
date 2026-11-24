import { api, apiUpload } from "@/api/client";
import { cropCompress, loadImage } from "@/features/admin/image-tools";
import { readPhotoMeta } from "./exif-meta";
import { flashText } from "@/ui/flash-notice";

/**
 * 更換 EDM 照片（網頁版，業主 2026-11-23）：選一張新圖 → 瀏覽器先壓縮 → 換掉這張照片；綁定課程的 EDM 會同時換掉那堂課的 EDM。
 * maxSide／quality 用「設定 › 儲存空間管理」的中心封面畫質（與上傳 EDM 同一組）。
 */
export function replaceAlbumPhoto(id: string, opts: { maxSide: number; quality: number }, onDone: () => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/heic";
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      flashText("更換中…");
      const img = await loadImage(f);
      const s = Math.min(1, opts.maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const blob = await cropCompress(img, null, opts.maxSide, opts.quality);
      await apiUpload("PUT", `/admin/cover-media/${id}/replace?w=${Math.round(img.naturalWidth * s)}&h=${Math.round(img.naturalHeight * s)}`, blob, () => undefined);
      await api("PUT", `/admin/cover-media/${id}/meta`, await readPhotoMeta(f, img.naturalWidth, img.naturalHeight)).catch(() => undefined);
      onDone();
      flashText("已更換照片");
    } catch (e) {
      flashText((e as Error).message || "更換失敗，請再試一次");
    }
  };
  input.click();
}
