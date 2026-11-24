import { View } from "react-native";
import type { Lesson } from "@/api/client";
import { CoverAlbum } from "@/features/courses/album";
import { useCoverMedia } from "@/features/courses/cover-media";
import { AlbumUploadButton } from "@/features/uploads/album-upload";
import { space } from "@/theme/tokens";
import { AppText } from "@/ui";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";

/**
 * 區塊「新增照片」（業主 2026-11-24，先只有「實戰百寶箱」）：與中心「新增教材 › 上傳EDM」同一套上傳元件（AlbumUploadButton）與相簿（CoverAlbum，可排序、刪除）。
 * 照片屬於這個區塊；連結區塊（品牌卡的「實戰百寶箱」）傳進來的 photoKey 是來源區塊，所以兩邊是同一批照片。
 */
export function BlockPhotosSheet({ head, onClose, onChanged }: { head: Lesson; onClose: () => void; onChanged: () => void }) {
  const key = head.photoKey ?? null;
  const cm = useCoverMedia("course", key);
  const done = () => (cm.reload(), onChanged());
  return (
    <BottomSheet onClose={onClose}>
      <AppText variant="headline">{`${head.title}的照片`}</AppText>
      <SheetScroll>
        <View style={{ gap: space.md }}>
          {key ? <AlbumUploadButton kind="course" ownerKey={key} count={cm.items.length} onDone={done} label="新增照片" /> : null}
          {key ? <CoverAlbum kind="course" ownerKey={key} title={head.title} items={cm.items} canEdit onChanged={done} emptyHint="按上面的「新增照片」新增。" /> : null}
        </View>
      </SheetScroll>
    </BottomSheet>
  );
}
