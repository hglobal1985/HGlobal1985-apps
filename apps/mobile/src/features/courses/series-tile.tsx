import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { resolveUrl } from "@/api/client";
import { useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { useTheme } from "@/theme/theme";
import { radius } from "@/theme/tokens";
import { BrandCover, CornerRibbon, CourseCover } from "@/ui";
import { ribbonsFor } from "./ribbons";
import { CourseLessonsSheet } from "./course-lessons-sheet";
import { BlockSheet, SeriesSheet } from "./series-sheet";
import type { SeriesGroup } from "./sort";

/** EDM 填滿方框、靠上對齊（先依寬度放大，不夠高再依高度放大）。 */
/** viewY＝EDM 預設位置（0～1，與課程頁上方 EDM 舞台相同）：直式 EDM 放在 16:9 視窗裡，從這個位置開始顯示。 */
function TopFill({ uri, w, h, viewY = 0, fillBlur = false }: { uri: string; w: number; h: number; viewY?: number; fillBlur?: boolean }) {
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    Image.getSize(uri, (iw, ih) => alive && ih && setRatio(iw / ih), () => alive && setRatio(0.7));
    return () => {
      alive = false;
    };
  }, [uri]);
  const r = ratio ?? 0.7;
  // 圖比方框「矮胖」（高度不夠填滿）＝完整顯示（不裁切），背景用同一張圖放大模糊填滿。
  if (fillBlur && ratio !== null && r > w / h) {
    const ch = w / r;
    return (
      <>
        <Image source={{ uri }} resizeMode="cover" blurRadius={18} style={[{ position: "absolute", top: -12, left: -12, width: w + 24, height: h + 24 }, Platform.OS === "web" ? ({ filter: "blur(18px)" } as object) : null]} accessibilityIgnoresInvertColors />
        <Image source={{ uri }} resizeMode="contain" style={{ position: "absolute", top: (h - ch) / 2, left: 0, width: w, height: ch }} accessibilityIgnoresInvertColors />
      </>
    );
  }
  const iw = Math.max(w, h * r);
  const ih = iw / r;
  const top = -Math.min(Math.max(0, ih - h), Math.max(0, viewY * ih));
  return <Image source={{ uri }} resizeMode="stretch" style={{ position: "absolute", top, left: (w - iw) / 2, width: iw, height: ih }} accessibilityIgnoresInvertColors />;
}

/**
 * 「全部課程」的小卡片：只有 EDM（整張封面可點，點了從下方彈出梯次選單；封面上不放任何文字）。
 * 有系列＝顯示系列的專屬 EDM，沒上傳就用系列名稱當大標題；沒有系列＝顯示課程自己的 EDM（沒有就用課程名稱）。
 * flat（中心模式選了某中心時）：所有課程平鋪，同系列也不合併。
 * 緞帶仍然顯示，文字以日期最近的那一梯為準。不顯示任何課程資訊欄位。
 */
export function SeriesTile({ group, width, flat = false }: { group: SeriesGroup; width: number; flat?: boolean }) {
  const { c } = useTheme();
  const { member } = useSession();
  const { config } = useUiConfig();
  const [sheet, setSheet] = useState(false);
  const rep = group.nearest;
  // 平鋪（flat，中心頁）＝直式 4:3（寬 3：高 4）；其餘維持橫式 16:9。
  const height = flat ? Math.round((width * 4) / 3) : Math.round((width * 9) / 16);
  // flat＝平鋪：不看系列，這張卡就是這一門課（用課程自己的 EDM、點了直接進課程頁）。
  const inSeries = !flat && !!rep.series;
  // 平鋪（flat，中心頁）：統一用直式 4:3 卡片顯示直式 EDM（寬度填滿、從管理員設定的預設位置開始；圖太小／太矮就完整顯示，用同一張圖模糊填滿背景）；沒有 EDM 才退回封面。
  const cropped = (flat && !rep.edmUrl && !!rep.coverUrl) || (!flat && inSeries && !!rep.seriesCoverUrl);
  // 系列小卡：有管理員裁切好的系列封面就用封面（16:9），沒有才用系列 EDM（業主 2026-11-17：新上傳的高 EDM 沒用裁切後的封面，字被切掉）。
  const edm = flat ? rep.edmUrl || rep.coverUrl : inSeries ? rep.seriesCoverUrl || rep.seriesEdmUrl : rep.edmUrl;
  const ribbons = ribbonsFor(rep, member, config);
  // flat（中心頁）：點課程彈出章節選單；其他模式：多梯次／系列彈出梯次選單，單一課程直接進課程頁。
  // 系列裡只有一份清單：有勾「顯示在上拉選單」的區塊就彈出區塊選單，沒有區塊就直接進清單頁（業主 2026-11-18）。
  const soloList = !flat && group.sessions.length === 1 && rep.isList;
  const open = () => (soloList && !rep.blocks.length ? router.push(`/course/${rep.id}`) : flat || group.sessions.length > 1 || inSeries ? setSheet(true) : router.push(`/course/${rep.id}`));
  return (
    <View style={{ width }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${inSeries ? rep.series : rep.title}，${flat ? "看章節" : "瀏覽細節"}`} onPress={open} style={[styles.art, { width, height, backgroundColor: edm ? "#fff" : c.surfaceMuted }]}>
        {rep.brand && !inSeries ? <BrandCover brand={rep.brand} fill /> : edm && cropped ? <Image source={{ uri: resolveUrl(edm) }} resizeMode="cover" style={{ position: "absolute", top: 0, left: 0, width, height }} accessibilityIgnoresInvertColors /> : edm ? <TopFill uri={resolveUrl(edm)} w={width} h={height} viewY={flat ? rep.edmViewY : 0} fillBlur={flat} /> : <CourseCover theme={rep.theme} label={rep.category} title={inSeries ? rep.series : rep.title} fill />}
        {ribbons.left ? <CornerRibbon label={ribbons.left.label} bg={ribbons.left.bg} fg={ribbons.left.fg} side="left" scale={0.8} /> : null}
        {ribbons.right ? <CornerRibbon label={ribbons.right.label} bg={ribbons.right.bg} fg={ribbons.right.fg} side="right" scale={0.8} /> : null}
        {/* 管理者才看得到的未上架課程：左下角標「未上架」（學員的清單裡不會有這些課）。 */}
        {group.sessions.some((x) => x.status === "draft") ? (
          <View style={[styles.draft, { backgroundColor: c.warning }]}>
            <Text style={styles.draftText}>{group.sessions.every((x) => x.status === "draft") ? "未上架" : "含未上架"}</Text>
          </View>
        ) : null}
      </Pressable>
      {sheet && flat ? <CourseLessonsSheet course={rep} onClose={() => setSheet(false)} /> : null}
      {sheet && !flat && soloList && rep.blocks.length ? <BlockSheet course={rep} onClose={() => setSheet(false)} /> : sheet && !flat ? <SeriesSheet title={inSeries ? rep.series : rep.title} items={group.sessions} showAllSeries={inSeries ? rep.series : undefined} onClose={() => setSheet(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  art: { borderRadius: radius.md, overflow: "hidden" },
  draft: { position: "absolute", left: 6, bottom: 6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  draftText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
