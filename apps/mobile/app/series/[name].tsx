import { useLocalSearchParams } from "expo-router";
import { SeriesPage } from "@/features/courses/series-page";

/** 系列單頁（沒有設定短網址時的網址 /series/系列名稱）：版面在 features/courses/series-page.tsx（比照中心頁）。 */
export default function SeriesRoute() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const series = decodeURIComponent(String(name ?? ""));
  return <SeriesPage series={series} path={`/series/${encodeURIComponent(series)}`} />;
}
