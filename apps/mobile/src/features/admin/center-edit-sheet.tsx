import { EditSheet } from "@/features/course-edit/edit-sheet";
import { centerTitle } from "@/features/format";
import type { CenterArt } from "@/api/client";
import { CenterAddressField } from "./center-address-field";
import { CenterBroadcastEditor } from "./center-broadcast-editor";
import { CenterEdm } from "./center-edm";
import { CenterNameField } from "./center-name-field";

/** 中心頁 TopBar「編輯」面板：名稱、地址、中心首頁圖、廣播公告（2026-11-21 由 courses-view.tsx 拆出來，只有管理者打開時才下載）。 */
export function CenterEditSheet({ center, address, art, onClose, onAddressSaved, onArtChanged, onBroadcastChanged }: { center: string; address: string; art?: CenterArt | null; onClose: () => void; onAddressSaved: () => void; onArtChanged: () => void; onBroadcastChanged: () => void }) {
  return (
    <EditSheet title={`編輯${centerTitle(center)}`} onClose={onClose} hideSave>
      <CenterNameField key={center} center={center} />
      <CenterAddressField center={center} current={address} onSaved={onAddressSaved} />
      <CenterEdm center={center} art={art} onChanged={onArtChanged} />
      <CenterBroadcastEditor center={center} onChanged={onBroadcastChanged} />
    </EditSheet>
  );
}
