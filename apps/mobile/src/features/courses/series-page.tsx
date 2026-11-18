import { trackFeature } from "@/lib/feature-track";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { api, type CourseSummary, type SeriesArt } from "@/api/client";
import { SeriesEdm } from "@/features/admin/series-edm";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { PageHeader } from "@/features/page-header";
import { isSuperAdmin } from "@/lib/roles";
import { useApi, useSession } from "@/state/session";
import { portraitColumns } from "@/theme/layout";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { CardGrid, EmptyState, ErrorView, LoadingView, LoginPrompt, Screen } from "@/ui";
import { TopBarButton } from "@/ui/top-bar";
import { CenterHero, centerHeroFull } from "./center-hero";
import { lessonsOf } from "./category-sheet";
import { CourseRow } from "./course-row";
import { nearestFirst } from "./sort";
import { SeriesTile } from "./series-tile";
import { useSubscribe } from "./subscribe";

type View_ = "list" | "edm";
const KEY = "hglobal:learn:series-view";
const GAP = space.md;

/**
 * 系列單頁（全部課程 > 系列 > 顯示全部；業主 2026-11-16 改版，版面比照中心頁）：
 * 上方工具列（返回、標題、超級管理員的「編輯」、分享）→ 照片區（封面圖＋「N 門課・N 章節・N 點閱」，可上滑縮小）→
 * 右上角切換「詳細清單」（每堂課一行，右側有分享）與「圖片 EDM」（一列三張，同中心頁的呈現）。
 * 照片與封面上傳都跟中心共用同一套（CenterHero、ArtUploader）。
 */
export function SeriesPage({ series, path }: { series: string; path: string }) {
  const { c } = useTheme();
  const { member } = useSession();
  const { data, error, loading, reload } = useApi<CourseSummary[]>("/courses");
  const artList = useApi<SeriesArt[]>("/series-art");
  const adminList = useApi<CourseSummary[]>(member?.courseRights ? "/admin/courses" : null);
  const [views, setViews] = useState<number | null>(null);
  const [view, setView] = useState<View_>("list");
  const [editOpen, setEditOpen] = useState(false);
  const [boxW, setBoxW] = useState(0);
  const scrollY = useRef(new Animated.Value(0)).current;
  const { width: winW, height: winHeight } = useWindowDimensions();
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => (v === "list" || v === "edm") && setView(v))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    trackFeature("series_page");
    api<{ total: number }>("POST", "/series-views", { series })
      .then((r) => setViews(r.total))
      .catch(() => undefined);
  }, [series]); // eslint-disable-line react-hooks/exhaustive-deps
  const courses = useMemo(() => {
    const pub = (data ?? []).filter((x) => x.status === "published" && x.viewScope !== "link_login" && x.viewScope !== "link_guest");
    const ids = new Set(pub.map((x) => x.id));
    const all = [...pub, ...(adminList.data ?? []).filter((x) => x.status === "draft" && !ids.has(x.id))];
    return nearestFirst(all.filter((x) => x.series === series));
  }, [data, adminList.data, series]);
  const sub = useSubscribe("series", series, path);
  // 分享網址一律用系列短網址（/Beauty-Starry），沒設定才用 /series/名稱（業主 2026-11-17）；網頁版網址列也換成短網址。
  const links = useApi<{ kind: string; value: string; slug: string }[]>("/short-links");
  const slug = links.data?.find((l) => l.kind === "series" && l.value === series)?.slug;
  const sharePath = slug ? `/${slug}` : path;
  useEffect(() => {
    if (Platform.OS === "web" && slug && typeof window !== "undefined" && window.location.pathname !== sharePath) window.history.replaceState(window.history.state, "", sharePath + window.location.search);
  }, [slug, sharePath]);
  const art = artList.data?.find((x) => x.series === series);
  const pick = (v: View_) => {
    setView(v);
    AsyncStorage.setItem(KEY, v).catch(() => undefined);
  };
  const cols = portraitColumns(boxW); // 手機一列三張；大螢幕依寬度增加（業主 2026-11-18）
  const tileW = boxW ? Math.floor((boxW - GAP * (cols - 1)) / cols) : 0;
  const toggle = (v: View_, icon: "list-outline" | "grid-outline", label: string) => (
    <Pressable key={v} accessibilityRole="radio" accessibilityState={{ selected: view === v }} accessibilityLabel={label} onPress={() => pick(v)} style={[styles.tbtn, view === v && { backgroundColor: c.accent }]}>
      <Ionicons name={icon} size={22} color={view === v ? c.textOnAccent : c.text} />
    </Pressable>
  );
  return (
    <>
      <PageHeader
        title={series}
        path={sharePath}
        extra={isSuperAdmin(member) ? <TopBarButton label="編輯" accessibilityLabel="編輯系列封面" iconName="create-outline" onPress={() => setEditOpen(true)} /> : undefined}
      />
      <Screen wide header={false} hero={<CenterHero art={art} scrollY={scrollY} courses={courses.length} lessons={lessonsOf(courses)} views={views} title={series} subscribe={sub} />} heroHeight={centerHeroFull(winW, winHeight)} scrollY={scrollY}>
        <LoginPrompt />
        {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
        {loading && !data ? <LoadingView /> : null}
        {data && !courses.length ? <EmptyState icon="library-outline" title="這個系列目前沒有課程" /> : null}
        {courses.length ? (
          <View style={[styles.toggle, { borderColor: c.border, backgroundColor: c.surface }]} accessibilityRole="radiogroup">
            {toggle("list", "list-outline", "詳細清單")}
            {toggle("edm", "grid-outline", "圖片 EDM")}
          </View>
        ) : null}
        {view === "list" ? <CardGrid>{courses.map((x) => <CourseRow key={x.id} course={x} />)}</CardGrid> : null}
        {view === "edm" ? (
          <View style={styles.grid} onLayout={(e) => setBoxW(Math.floor(e.nativeEvent.layout.width))}>
            {tileW ? courses.map((x) => <SeriesTile key={x.id} group={{ key: `c:${x.id}`, nearest: x, sessions: [x] }} width={tileW} flat />) : null}
          </View>
        ) : null}
      </Screen>
      {editOpen ? (
        <EditSheet title={`編輯「${series}」`} onClose={() => setEditOpen(false)} hideSave>
          <SeriesEdm series={series} edmUrl={art?.edmUrl} onChanged={artList.reload} />
        </EditSheet>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  toggle: { alignSelf: "flex-end", flexDirection: "row", borderWidth: 1, borderRadius: radius.md, overflow: "hidden", height: minTouch, marginBottom: space.sm },
  tbtn: { width: 48, height: "100%", alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP, rowGap: space.lg },
});
