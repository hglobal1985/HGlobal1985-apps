import { EditSheet } from "@/features/course-edit/edit-sheet";
import { centerTitle } from "@/features/format";
import type { CenterArt } from "@/api/client";
import { CenterAddressField } from "./center-address-field";
import { CenterBroadcastEditor } from "./center-broadcast-editor";
import { CenterCoverPhotos } from "./center-cover-photos";
import { CenterScheduleEditor } from "./center-schedule-editor";
import { CenterNameField } from "./center-name-field";
import { ThumbBadgeEditor } from "./thumb-badge-editor";

/** 中心頁 TopBar「編輯」面板：名稱、地址、中心首頁圖、封面輪播照片、廣播公告（2026-11-21 由 courses-view.tsx 拆出來，只有管理者打開時才下載）。 */
export function CenterEditSheet({ center, address, art, onClose, onAddressSaved, onArtChanged, onBroadcastChanged, onScheduleChanged, onCoverChanged }: { center: string; address: string; art?: CenterArt | null; onClose: () => void; onAddressSaved: () => void; onArtChanged: () => void; onBroadcastChanged: () => void; onScheduleChanged: () => void; /** 封面輪播照片或「顯示 EDM」勾選變動後，重新讀取中心頁封面。 */ onCoverChanged: () => void }) {
  return (
    <EditSheet title={`編輯${centerTitle(center)}`} onClose={onClose} hideSave>
      <CenterNameField key={center} center={center} />
      <CenterAddressField center={center} current={address} onSaved={onAddressSaved} />
      <CenterCoverPhotos center={center} onChanged={() => { onCoverChanged(); onArtChanged(); }} />
      <ThumbBadgeEditor kind="center" id={center} label={centerTitle(center)} />
      <CenterBroadcastEditor center={center} onChanged={onBroadcastChanged} />
      <CenterScheduleEditor center={center} onChanged={onScheduleChanged} />
    </EditSheet>
  );
}

/** 中心頁右下「＋新增教材 › 上傳課表」直接開的面板（業主 2026-11-21）：只有課表管理，上傳後立刻出現在中心頁。 */
export function CenterScheduleSheet({ center, onClose, onChanged }: { center: string; onClose: () => void; onChanged: () => void }) {
  return (
    <EditSheet title={`上傳${centerTitle(center)}課表`} onClose={onClose} hideSave>
      <CenterScheduleEditor center={center} onChanged={onChanged} />
    </EditSheet>
  );
}
