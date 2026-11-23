import { View } from "react-native";
import { api } from "@/api/client";
import { CoverAlbum } from "@/features/courses/album";
import { useCoverMedia } from "@/features/courses/cover-media";
import { AlbumUploadButton } from "@/features/uploads/album-upload";
import { Check, FormBlock } from "@/ui";
import { flashText } from "@/ui/flash-notice";

/**
 * 中心封面輪播照片（業主 2026-11-23）：封面編輯裡才能新增、排序、刪除；與中心頁「EDM」分頁的照片是兩個獨立的儲存區。
 * 「封面輪播顯示 EDM」勾選（預設打勾）：勾選時，封面會先輪播這裡的照片，接著輪播 EDM 分頁的照片；取消勾選就只輪播這裡的照片。
 * EDM 照片只要不是橫式（直式、接近方形），輪播時一律三張併成一個橫式畫面（cover-media.ts 的 buildSlides）。
 */
export function CenterCoverPhotos({ center, onChanged }: { center: string; onChanged: () => void }) {
  const cm = useCoverMedia("center", center);
  const changed = () => {
    cm.reload();
    onChanged();
  };
  const toggle = async (v: boolean) => {
    try {
      await api("PUT", "/admin/cover-media/config", { kind: "center", key: center, showEdm: v });
      changed();
      flashText(v ? "封面會一起輪播 EDM" : "封面只輪播封面照片");
    } catch (e) {
      flashText((e as Error).message);
    }
  };
  return (
    <FormBlock title="封面輪播照片" hint="只能在這裡管理；和「EDM」分頁的照片分開存放。照片與短影音最多各 100 張。">
      <View style={{ gap: 12 }}>
        <Check label="封面輪播顯示 EDM" value={cm.showEdm} onChange={toggle} />
        <AlbumUploadButton kind="center" ownerKey={center} scope="cover" count={cm.cover.length} onDone={changed} />
        <CoverAlbum kind="center" scope="cover" ownerKey={center} title={center} items={cm.cover} canEdit onChanged={changed} emptyHint="按上方「上傳照片或影片」新增封面輪播照片。" />
      </View>
    </FormBlock>
  );
}
