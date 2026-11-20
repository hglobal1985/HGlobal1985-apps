import { useEffect, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { resolveUrl, UNCATEGORIZED } from "@/api/client";
import { useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { useThumb } from "@/lib/thumb";
import { useTheme } from "@/theme/theme";
import { radius } from "@/theme/tokens";
import { BrandCover, CornerRibbon, CourseCover } from "@/ui";
import { ribbonsFor } from "./ribbons";
import { CourseLessonsSheet } from "./course-lessons-sheet";
import { CardCount } from "@/ui/card-count";
import { BlockSheet, MaterialsSheet, SeriesSheet } from "./series-sheet";
import { useSeriesSettings } from "./series-settings";
import { nearestOf, type SeriesGroup } from "./sort";

/** EDM 填滿方框、靠上對齊（先依寬度放大，不夠高再依高度放大）。 */
/** viewY＝EDM 預設位置（0～1，與課程頁上方 EDM 舞台相同）：直式 EDM 放在 16:9 視窗裡，從這個位置開始顯示。 */
export function TopFill({ uri, w, h, viewY = 0, fillBlur = false }: { uri: string; w: number; h: number; viewY?: number; fillBlur?: boolean }) {
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
  const thumb = useThumb();
  const [sheet, setSheet] = useState(false);
  const settings = useSeriesSettings();
  // 系列卡（業主 2026-11-19）：被系列頁隱藏的卡不算；系列裡只有一張卡時，第一層直接顯示那張卡的內容、點了直接進去。
  const cards = group.sessions.filter((x) => !x.seriesHidden);
  const sessions = cards.length ? cards : group.sessions;
  const rep = group.nearest.series && !group.nearest.seriesHidden && sessions.includes(group.nearest) ? group.nearest : sessions.length === 1 ? sessions[0]! : nearestOf(sessions);
  // 平鋪（flat，中心頁）＝直式 4:3（寬 3：高 4）；其餘維持橫式 16:9。
  const height = flat ? Math.round((width * 4) / 3) : Math.round((width * 9) / 16);
  // flat＝平鋪：不看系列，這張卡就是這一門課（用課程自己的 EDM、點了直接進課程頁）。
  const inSeries = !flat && !!rep.series && sessions.length >= 2;
  // 只要有系列（中心卡除外），不論裡面幾張卡，點了一律先彈上拉選單（業主 2026-11-20：單張卡的系列也要有）。封面顯示仍用 inSeries。
  const hasSeries = !flat && !!rep.series;
  // 系列裡只有一張教材卡：上拉選單直接顯示這張卡的內容，「區塊 > 教材」二者則一（業主 2026-11-20）；兩張以上才是梯次／卡片清單。
  const soloSeries = hasSeries && sessions.length === 1;
  // 平鋪（flat，中心頁）：統一用直式 4:3 卡片顯示直式 EDM（寬度填滿、從管理員設定的預設位置開始；圖太小／太矮就完整顯示，用同一張圖模糊填滿背景）；沒有 EDM 才退回封面。
  // 第一層的卡（業主 2026-11-19 更正：指定的封面裁切位置沒生效）：
  // 系列卡＝系列的封面（橫式裁切）；單張卡／獨立清單卡＝這張卡自己裁好的封面 > 系列封面 > EDM（照「預設顯示位置」從該處開始顯示）。中心頁（flat）照舊。
  const ownCover = !flat && !inSeries ? rep.coverUrl || rep.seriesCoverUrl : null;
  const cropped = (flat && !rep.edmUrl && !!rep.coverUrl) || (!flat && inSeries && !!rep.seriesCoverUrl) || !!ownCover;
  // 系列小卡：有管理員裁切好的系列封面就用封面（16:9），沒有才用系列 EDM（業主 2026-11-17：新上傳的高 EDM 沒用裁切後的封面，字被切掉）。
  const edm = flat ? rep.edmUrl || rep.coverUrl : inSeries ? rep.seriesCoverUrl || rep.seriesEdmUrl : ownCover || rep.edmUrl;
  const ribbons = ribbonsFor(rep, member, config);
  const count = sessions.reduce((n, x) => n + x.materialCount, 0);
  // flat（中心頁）：點課程彈出章節選單；其他模式：多梯次／系列彈出梯次選單，單一課程直接進課程頁。
  // 系列卡（業主 2026-11-20 改回）：點了先彈出上拉選單（列出系列內的卡，右上「顯示全部」或繼續上拉才進系列頁）；單張卡直接進該卡；中心頁的課程卡照舊彈章節選單。
  // 第一層任何卡（中心卡除外）點了都先彈上拉選單：系列＝卡片清單；單張卡／獨立卡＝區塊 > 教材 > 章節（業主 2026-11-20）。
  const open = () => setSheet(true);
  const unlisted = inSeries && !settings.listed(rep.series); // 只有超級管理員會看到：關掉了「顯示在所有系列」或是「未分類」
  return (
    <View style={{ width }} nativeID={`tile-${group.key}`}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${inSeries ? settings.titleOf(rep.series) : rep.title}，${flat ? "看章節" : "瀏覽細節"}`} onPress={open} style={[styles.art, { width, height, backgroundColor: edm ? "#fff" : c.surfaceMuted }, unlisted && { opacity: 0.55 }]}>
        {rep.brand && !inSeries ? <BrandCover brand={rep.brand} fill /> : edm && cropped ? <Image source={{ uri: thumb(resolveUrl(edm), width) }} resizeMode="cover" style={{ position: "absolute", top: 0, left: 0, width, height }} accessibilityIgnoresInvertColors /> : edm ? <TopFill uri={thumb(resolveUrl(edm), width)} w={width} h={height} viewY={flat || !inSeries ? rep.edmViewY : 0} fillBlur={flat} /> : <CourseCover theme={rep.theme} label={rep.category} title={inSeries ? settings.titleOf(rep.series) : rep.title} fill />}
        {ribbons.left ? <CornerRibbon label={ribbons.left.label} bg={ribbons.left.bg} fg={ribbons.left.fg} side="left" scale={0.8} /> : null}
        {ribbons.right ? <CornerRibbon label={ribbons.right.label} bg={ribbons.right.bg} fg={ribbons.right.fg} side="right" scale={0.8} /> : null}
        {/* 所有卡片右下角統一顯示教材數量（業主 2026-11-20，共用 CardCount；原本只有安麗品牌專區有）。中心頁（flat）是章節選單，不放。 */}
        {!flat ? <CardCount count={count} /> : null}
        {unlisted ? (
          <View style={[styles.draft, { backgroundColor: c.textMuted, left: undefined, right: 6, top: 6, bottom: undefined }]}>
            <Text style={styles.draftText}>{rep.series === UNCATEGORIZED ? "未分類（僅你可見）" : "未顯示於所有系列"}</Text>
          </View>
        ) : null}
        {/* 管理者才看得到的未上架課程：左下角標「未上架」（學員的清單裡不會有這些課）。 */}
        {sessions.some((x) => x.status === "draft") ? (
          <View style={[styles.draft, { backgroundColor: c.warning }]}>
            <Text style={styles.draftText}>{sessions.every((x) => x.status === "draft") ? "未上架" : "含未上架"}</Text>
          </View>
        ) : null}
      </Pressable>
      {sheet && hasSeries && !soloSeries ? <SeriesSheet title={settings.titleOf(rep.series)} items={sessions} showAllSeries={rep.series} onClose={() => setSheet(false)} /> : null}
      {sheet && flat ? <CourseLessonsSheet course={rep} onClose={() => setSheet(false)} /> : null}
      {sheet && !flat && (soloSeries || !hasSeries) && rep.blocks.length ? <BlockSheet course={rep} onClose={() => setSheet(false)} /> : null}
      {sheet && !flat && (soloSeries || !hasSeries) && !rep.blocks.length ? <MaterialsSheet course={rep} onClose={() => setSheet(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  art: { borderRadius: radius.md, overflow: "hidden" },
  draft: { position: "absolute", left: 6, bottom: 6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  draftText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
