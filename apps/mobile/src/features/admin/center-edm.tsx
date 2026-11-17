import type { CenterArt } from "@/api/client";
import { AppText } from "@/ui";

/** iOS／Android：中心首頁圖的上傳與裁切只在網頁版提供。 */
export function CenterEdm(_props: { center: string; art?: CenterArt | null; onChanged: () => void }) {
  return (
    <AppText variant="caption" tone="muted">
      中心首頁圖請在網頁版上傳
    </AppText>
  );
}
