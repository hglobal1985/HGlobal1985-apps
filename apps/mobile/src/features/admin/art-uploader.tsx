import { AppText } from "@/ui";

export type ArtInfo = { edmUrl: string; coverUrl?: string | null; coverRect?: { x: number; y: number; w: number } | null; edmViewY: number };

/** iOS／Android：封面上傳只在網頁版提供。 */
export function ArtUploader(_props: { label: string; art?: ArtInfo | null; endpoints: { edm: string; cover: string }; onChanged: () => void }) {
  return (
    <AppText variant="caption" tone="muted">
      EDM 與封面請在網頁版上傳
    </AppText>
  );
}
