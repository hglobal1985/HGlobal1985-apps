import { type SeriesArt } from "@/api/client";
import { useApi } from "@/state/session";
import { ArtUploader } from "./art-uploader.web";

/** 系列 EDM：與中心完全相同的「封面上傳模組」（art-uploader），目前狀態自己向 /series-art 取得。 */
export function SeriesEdm({ series, onChanged }: { series: string; edmUrl?: string | null; onChanged: () => void }) {
  const { data, reload } = useApi<SeriesArt[]>("/series-art");
  const art = data?.find((x) => x.series === series) ?? null;
  const q = `?series=${encodeURIComponent(series)}`;
  return (
    <ArtUploader
      label="系列"
      art={art}
      endpoints={{ edm: `/admin/series/edm${q}`, cover: `/admin/series/cover${q}` }}
      onChanged={() => {
        reload();
        onChanged();
      }}
    />
  );
}
