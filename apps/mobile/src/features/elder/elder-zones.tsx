import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { centerKeyOf } from "@/features/format";
import { groupBySeries, orderGroups, sortCourses } from "@/features/courses/sort";
import { useSeriesSettings } from "@/features/courses/series-settings";
import { elderTextScale } from "@/lib/elder-mode";
import { useApi, useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { UI_SCALE } from "@/theme/ui-scale";
import type { CenterArt, CourseSummary } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { AppText } from "@/ui";

/**
 * 至尊模式「課程」頁的四大分類（業主 2026-11-24，選定 D 款：一欄四張大卡）。
 * 分類與超派模式課程頁的四個區塊一致、順序一致：寰宇課程活動、寰宇教育中心、安麗官方資源、安麗品牌館。
 * 歸類：教育中心＝centerCourse；其餘看課程的 zone（hglobal／amway_material／amway_brand）。
 * 顏色與 courses-view.tsx 的 ZONE_PALETTE 相同（綠、紅、黃、藍）；改那邊的顏色這裡要一起改。
 */
export type ElderZone = "hglobal" | "centers" | "amway_material" | "amway_brand";

export const ELDER_ZONES: { id: ElderZone; label: string; icon: "library" | "business" | "folder-open" | "pricetag"; unit: string }[] = [
  { id: "hglobal", label: "寰宇課程活動", icon: "library", unit: "項教材" },
  { id: "centers", label: "寰宇教育中心", icon: "business", unit: "項教材" },
  { id: "amway_material", label: "安麗官方資源", icon: "folder-open", unit: "項教材" },
  { id: "amway_brand", label: "安麗品牌館", icon: "pricetag", unit: "項教材" },
];

export const elderZoneOf = (x: CourseSummary): ElderZone => (x.centerCourse ? "centers" : x.zone);

const PALETTE: Record<ElderZone, Record<"light" | "dark", { bg: string; fg: string } | null>> = {
  hglobal: { light: null, dark: null }, // 用主題的淡綠
  centers: { light: { bg: "#FCE1DE", fg: "#8F1D18" }, dark: { bg: "#3B1B19", fg: "#F0A8A2" } },
  amway_material: { light: { bg: "#FFF3C4", fg: "#5A4300" }, dark: { bg: "#3A3112", fg: "#F2D675" } },
  amway_brand: { light: { bg: "#DCEBFA", fg: "#0F3D6E" }, dark: { bg: "#15283D", fg: "#8EC1F0" } },
};

export function useZoneLook(zone: ElderZone) {
  const { c, scheme } = useTheme();
  const p = PALETTE[zone][scheme];
  return { bg: p?.bg ?? c.accentSoft, fg: p?.fg ?? c.accentText };
}

/** 標題強制單行、依容器寬度與字數自動縮字（業主 2026-11-24）：畫字時會再乘「平板倍數 × 至尊倍數」，所以在放大前的尺寸上算。 */
function FitTitle({ text, color }: { text: string; color: string }) {
  const [w, setW] = useState(0);
  const k = UI_SCALE * elderTextScale();
  const size = w ? Math.max(10, Math.min(24, Math.floor(w / k / ([...text].length * 1.05)))) : 20;
  return (
    <View style={{ flex: 1, minWidth: 0 }} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
      <AppText numberOfLines={1} style={{ color, fontWeight: "900", fontSize: size, lineHeight: Math.round(size * 1.3) }}>
        {text}
      </AppText>
    </View>
  );
}

/** 一欄四張大卡之一：圖示、名稱、數量、箭頭；整張可點。 */
export function ElderZoneCard({ zone, count, onPress }: { zone: (typeof ELDER_ZONES)[number]; count: number; onPress: () => void }) {
  const look = useZoneLook(zone.id);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${zone.label}，${count} ${zone.unit}`} onPress={onPress} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: 20, padding: space.lg, backgroundColor: look.bg, opacity: pressed ? 0.85 : 1 }]}>
      <Ionicons name={zone.icon} size={36} color={look.fg} {...({ uiOnly: true } as object)} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <FitTitle text={zone.label} color={look.fg} />
        <AppText variant="callout" style={{ color: look.fg, fontWeight: "700" }}>
          {`${count} ${zone.unit}`}
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={30} color={look.fg} {...({ uiOnly: true } as object)} />
    </Pressable>
  );
}

/** 進入某一區之後的標題列：返回鍵＋分類名稱（同色帶）。 */
export function ElderZoneHeader({ zone, sub, onBack }: { zone: (typeof ELDER_ZONES)[number]; /** 再往下一層（系列／中心）的名稱。 */ sub?: string; onBack: () => void }) {
  const look = useZoneLook(zone.id);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`返回，${zone.label}`} onPress={onBack} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: 20, padding: space.md, backgroundColor: look.bg }}>
      <Ionicons name="chevron-back" size={30} color={look.fg} {...({ uiOnly: true } as object)} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <FitTitle text={zone.label} color={look.fg} />
        {sub ? (
          <AppText variant="headline" numberOfLines={2} style={{ color: look.fg, fontWeight: "800" }}>
            {sub}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * 分類裡面的項目，內容與排序跟超派模式課程頁完全一致（業主 2026-11-24 回報：除了安麗品牌館，其餘三區點進去的內容不一致）：
 * - 寰宇課程活動／安麗官方資源／安麗品牌館＝「系列」小卡（同系列合成一張，沒有系列的課自己一張；沿用 groupBySeries、系列顯示設定、手動排序）。
 * - 寰宇教育中心＝各「中心」（依教材總數多到少，「安麗公司」不列）。
 * 每個項目的數字＝教材總數（materialCount 加總）。點系列／中心再往下一層列出裡面的課程（只有一門課就直接進課程頁）。
 */
export type ZoneItem = { key: string; title: string; count: number; rep: CourseSummary; series?: boolean; /** 中心列：中心封面圖。 */ coverUrl?: string | null; /** 往下一層要列的課程；undefined＝直接進 rep 這門課。 */ children?: CourseSummary[] };

const norm = (v: string) => v.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const HIDDEN_CENTERS = new Set(["安麗公司"].map(norm));

export function useZoneItems(all: CourseSummary[]): (zone: ElderZone) => ZoneItem[] {
  const { member } = useSession();
  const { config } = useUiConfig();
  const settings = useSeriesSettings();
  const centers = useApi<string[]>("/centers");
  const art = useApi<CenterArt[]>("/center-art");
  return useMemo(() => {
    const sorted = sortCourses(all, member, config.sortGroups);
    const pool = sorted.filter((x) => !x.centerCourse || !!x.series?.trim());
    const shown = groupBySeries(pool, pool).filter((g) => (!g.nearest.series || settings.listed(g.nearest.series)) && (settings.admin || g.sessions.some((x) => !x.seriesHidden)));
    const groups = orderGroups(shown, config.seriesOrder ?? []);
    const sum = (xs: CourseSummary[]) => xs.reduce((n, x) => n + x.materialCount, 0);
    const seriesItems = (zone: ElderZone): ZoneItem[] =>
      groups
        .filter((g) => g.nearest.zone === zone)
        .map((g) => {
          const cards = g.sessions.filter((x) => !x.seriesHidden);
          const sessions = cards.length ? cards : g.sessions;
          const rep = sessions.includes(g.nearest) ? g.nearest : sessions[0]!;
          const inSeries = !!rep.series && sessions.length >= 2;
          return { key: g.key, title: inSeries ? settings.titleOf(rep.series) : rep.title, count: sum(sessions), rep, series: inSeries, children: inSeries ? sessions : undefined };
        });
    const centerItems = (): ZoneItem[] =>
      (centers.data ?? [])
        .filter((name) => !HIDDEN_CENTERS.has(norm(name)))
        .map((name) => {
          const mine = sorted.filter((x) => x.centerCourse && x.hasMaterial && norm(x.hostCenter ?? "") === norm(name));
          return { name, mine };
        })
        .filter((x) => x.mine.length)
        .map((x) => {
          const a = art.data?.find((v) => v.centerKey === centerKeyOf(x.name) || v.center === x.name);
          return { key: `center:${x.name}`, title: x.name, count: sum(x.mine), rep: x.mine[0]!, children: x.mine, coverUrl: a ? a.coverUrl ?? a.edmUrl : null };
        })
        .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, "zh-Hant"));
    return (zone: ElderZone) => (zone === "centers" ? centerItems() : seriesItems(zone));
  }, [all, member, config.sortGroups, config.seriesOrder, settings, centers.data, art.data]);
}
