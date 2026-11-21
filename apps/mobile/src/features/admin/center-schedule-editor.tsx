import { AppText } from "@/ui";

/** iOS／Android：課表圖片的上傳只在網頁版提供。 */
export function CenterScheduleEditor(_props: { center: string; onChanged: () => void }) {
  return (
    <AppText variant="caption" tone="muted">
      課表圖片請在網頁版上傳
    </AppText>
  );
}
