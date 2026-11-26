import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api } from "@/api/client";
import { AppText } from "@/ui";
import { SubscribeButton, useSubscribe, type SubKind, type SubscribeProps } from "./subscribe";

/**
 * 封面統計模組（杜杜龍 2026-11-18：所有課程、教材清單、系列、中心的首頁封面圖，一律放同一組「訂閱鈕＋點閱次數」；
 * 之後要改樣式、位置、文字，只改這個檔案，全站一起變）：
 *  - `useCoverStats(kind, key, loginNext, noun?)`：進入頁面就把點閱 +1（訪客也算、重新整理也算），並讀取訂閱人數與狀態；
 *    kind＝中心 `center`（key＝中心名稱）／系列 `series`（key＝系列名稱）／課程與教材清單 `course`（key＝課程編號）。
 *  - `CoverBadges`：封面下緣那一排（左：訂閱鈕，右：「N 點閱」）。不再顯示課程數、章節數（杜杜龍 2026-11-18 刪除）。
 * 用在：中心頁與系列頁封面（`CenterHero`）、課程與教材清單頁封面（`EdmStage`）。新增任何有封面的頁面也一律用它。
 */
export type CoverStats = { subscribe?: SubscribeProps; views: number | null };

const VIEW_API: Record<SubKind, { path: string; body: (key: string) => object }> = {
  center: { path: "/center-views", body: (key) => ({ center: key }) },
  series: { path: "/series-views", body: (key) => ({ series: key }) },
  course: { path: "/course-views", body: (key) => ({ courseId: key }) },
};

export function useCoverStats(kind: SubKind, key: string | null, loginNext: string, noun?: string): CoverStats {
  const [views, setViews] = useState<number | null>(null);
  useEffect(() => {
    setViews(null);
    if (!key) return;
    api<{ total?: number }>("POST", VIEW_API[kind].path, VIEW_API[kind].body(key))
      .then((r) => setViews(typeof r.total === "number" ? r.total : null))
      .catch(() => undefined);
  }, [kind, key]);
  const subscribe = useSubscribe(kind, key, loginNext, noun);
  return { subscribe, views };
}

export function CoverBadges({ stats }: { stats: CoverStats }) {
  return (
    <View style={styles.row} pointerEvents="box-none">
      {/* 訂閱鈕（杜杜龍 2026-11-17）：最左邊、比標籤大、實心不透明；鈴鐺圖案與主選單「通知」一致，旁邊是訂閱人數。 */}
      {stats.subscribe ? <SubscribeButton {...stats.subscribe} /> : null}
      <View style={styles.chip} pointerEvents="none">
        <AppText variant="caption" style={styles.chipText} {...({ dataSet: { noScale: "" } } as object)}>
          {stats.views ?? 0} 點閱
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 訂閱鈕在左下角、點閱在右下角（杜杜龍 2026-11-21 方案 A）：外層容器左右各留 12，這一排撐滿寬度、兩端對齊。
  row: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "space-between", alignSelf: "stretch" },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.42)" },
  chipText: { color: "#fff", fontWeight: "700" },
});
