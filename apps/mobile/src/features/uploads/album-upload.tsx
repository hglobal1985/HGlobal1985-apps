import { View } from "react-native";
import type { CoverMediaKind, CoverScope } from "@/api/client";
import { NoticeBox } from "@/ui";

/** App（iOS／Android）版：相簿上傳先只有網頁版（業主 2026-11-21）。 */
export function AlbumUploadButton(_p: { kind: CoverMediaKind; ownerKey: string; count: number; onDone: () => void; scope?: CoverScope; label?: string; folder?: string }) {
  return (
    <View>
      <NoticeBox tone="info" text="上傳照片與影片請用網頁版（learn.hglobal1985.com）。" />
    </View>
  );
}
