import type { SeriesArt } from "@/api/client";
import { CenterHero } from "@/features/courses/center-hero";
import { useCoverMedia } from "@/features/courses/cover-media";
import { useCoverStats } from "@/features/courses/cover-stats";
import { HeaderInvite } from "@/features/invite-button";
import { useApi } from "@/state/session";
import { View } from "react-native";
import { space } from "@/theme/tokens";
import { ElderBroadcastBox } from "./elder-broadcast";

type ShortLink = { kind: string; value: string; slug: string };

/** 分享／邀請用的網址：有設定短網址就用短網址，沒有就用原本的網址（與超派模式中心頁、系列頁同一條規則）。 */
export function useSharePath(kind: "center" | "series", value: string, fallback: string): string {
  const links = useApi<ShortLink[]>("/short-links");
  const slug = links.data?.find((l) => l.kind === kind && l.value === value)?.slug;
  return slug ? `/${slug}` : fallback;
}

/** 至尊模式標題區右上角的「邀請」鈕（杜杜龍 2026-11-24：和超派同一個 HeaderInvite，只放邀請、不放加入清單）。 */
export function ElderInvite({ kind, value, title, fallback }: { kind: "center" | "series"; value: string; title: string; fallback: string }) {
  const path = useSharePath(kind, value, fallback);
  return <HeaderInvite title={title} path={path} />;
}

/**
 * 至尊模式「系列」頁最上面（杜杜龍 2026-11-24：與中心卡統一）：封面輪播（含訂閱鈕、點閱數）→ 公告黃色區塊。
 * 封面、訂閱、點閱與超派模式系列頁是同一套（CenterHero、useCoverMedia("series")、useCoverStats("series")）。
 */
export function ElderSeriesHead({ series, title }: { series: string; title: string }) {
  const artList = useApi<SeriesArt[]>("/series-art");
  const art = artList.data?.find((x) => x.series === series);
  const cm = useCoverMedia("series", series);
  const stats = useCoverStats("series", series, `/series/${encodeURIComponent(series)}`);
  return (
    <View style={{ gap: space.md, marginBottom: space.md }}>
      <CenterHero inline art={art} media={cm.items} stats={stats} title={title} />
      <ElderBroadcastBox series={series} label={title} />
    </View>
  );
}
