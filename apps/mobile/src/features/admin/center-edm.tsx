import { AppText } from "@/ui";

/** iOS／Android：中心 EDM 的上傳只在網頁版提供。 */
export function CenterEdm(_props: { center: string; edmUrl?: string | null; onChanged: () => void }) {
  return (
    <AppText variant="caption" tone="muted">
      中心 EDM 請在網頁版上傳
    </AppText>
  );
}
