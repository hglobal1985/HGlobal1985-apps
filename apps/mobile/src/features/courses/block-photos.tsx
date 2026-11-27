import type { Lesson } from "@/api/client";
import { CoverAlbum } from "@/features/courses/album";

/**
 * 區塊照片（杜杜龍 2026-11-24，先只有「成交百寶箱」）：區塊展開後，教材上方先顯示這個區塊的照片格（點開放大、可左右翻）。
 * 照片＝cover_media（kind=course、key＝區塊編號），與中心 EDM 共用同一套上傳與相簿元件；連結區塊（品牌卡）看到的是來源區塊的同一批照片。
 * 超派、至尊模式都用它（資料來自課程頁的 lesson.photos）。
 */
export function BlockPhotos({ head }: { head: Lesson }) {
  const items = head.photos ?? [];
  if (!head.photoKey || !items.length) return null;
  return <CoverAlbum kind="course" ownerKey={head.photoKey} title={head.title} items={items} canEdit={false} onChanged={() => undefined} />;
}

/** 區塊有沒有照片（學員端判斷「這個區塊不是空的」用）。 */
export const blockPhotoCount = (head: Lesson) => head.photoCount ?? head.photos?.length ?? 0;
export const hasBlockPhotos = (head: Lesson) => blockPhotoCount(head) > 0;
