import { EditSheet } from "@/features/course-edit/edit-sheet";
import { SeriesEdm } from "./series-edm";
import { ThumbBadgeEditor } from "./thumb-badge-editor";

/** 系列頁「更換封面圖」面板（2026-11-21 由 series-page.tsx 拆出來，只有超級管理員打開時才下載）。 */
export function SeriesCoverSheet({ series, title, edmUrl, onClose, onChanged }: { series: string; title: string; edmUrl?: string | null; onClose: () => void; onChanged: () => void }) {
  return (
    <EditSheet title={`「${title}」封面圖`} onClose={onClose} hideSave>
      <SeriesEdm series={series} edmUrl={edmUrl} onChanged={onChanged} />
      <ThumbBadgeEditor kind="series" id={series} label={title} />
    </EditSheet>
  );
}
