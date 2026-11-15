import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CenterArt, CourseSummary } from "@/api/client";
import { CenterEdm } from "@/features/admin/center-edm";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { NewCourseSheet } from "@/features/course-edit/new-course";
import { ShortLinkRow } from "@/features/course-edit/short-link-row";
import { canCreateCourse, canManageCourses, isSuperAdmin } from "@/lib/roles";
import { CourseCard } from "./course-card";
import { EdmImageStage } from "./edm-viewer";
import { farToNear } from "./series-sheet";
import { SeriesTile } from "./series-tile";
import { CategoryFilterBox, CategoryHintBar, CategorySheet, NONE, courseCats as cats, matchesCats } from "./category-sheet";
import { CenterTile } from "./center-tile";
import { ModeFlash } from "./mode-flash";
import { ViewToggle, type CourseViewMode } from "./view-toggle";
import { ChapterList, type ChapterItem } from "./chapter-list";
import { buildSearchIndex, matchCourses, matchLessons, suggestTerms, type SearchLesson } from "./course-search";
import { SEARCH_ICON_W, SearchBox } from "./search-box";
import { groupBySeries, orderGroups, sortCourses } from "./sort";
import { useApi, useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Button, Card, EmptyState, ErrorView, ListRow, LoadingView, Screen, Select, type SelectBadge, type SelectOption } from "@/ui";

const ALL = "";
const HIDDEN_CATEGORY = "地區教育中心";
const MODE_KEY = "hglobal:learn:course-view-mode";
const GAP = space.md;

/**
 * 全部課程清單。initialCategory／initialCenter／series 由網址（短網址、?category=、?center=、?series=）帶入。
 * 「中心」下拉：選了中心，下方先顯示該中心的 EDM（有上傳才有），只列該中心主辦的課程。
 * 管理者（總部、會長、音控、小編）另外看得到自己能管的「未上架」課程（標示未上架）、最下面可展開「已封存」、右下角「＋新增課程」。
 */
export function CoursesView({ initialCategory = "", initialCenter = "", series = "", inStack = false }: { initialCategory?: string; initialCenter?: string; series?: string; inStack?: boolean }) {
  const { data, error, loading, reload } = useApi<CourseSummary[]>("/courses");
  const { member } = useSession();
  const manager = canManageCourses(member);
  const adminList = useApi<CourseSummary[]>(manager ? "/admin/courses" : null);
  const centerArt = useApi<CenterArt[]>("/center-art");
  // 已選的分類（可複選；多個＝同時有這些分類）。空陣列＝全部分類。
  const [selCats, setSelCats] = useState<string[]>(initialCategory ? initialCategory.split("、").filter(Boolean) : []);
  const category = selCats.join("、");
  const [catOpen, setCatOpen] = useState(false);
  const [center, setCenter] = useState(initialCenter || ALL);
  const seriesFilter = series;
  useEffect(() => {
    if (initialCategory) setSelCats(initialCategory.split("、").filter(Boolean));
  }, [initialCategory]);
  useEffect(() => {
    if (initialCenter) {
      setCenter(initialCenter);
      setMode("center"); // 從課程卡的「XX主辦」或中心短網址進來＝直接看該中心
    }
  }, [initialCenter]);
  // 網頁：網址列跟著篩選變：只選分類或只選中心＝該短網址（有設定才換）；兩個都選＝/courses?center=…&category=…；都沒選＝/courses。
  const links = useApi<{ kind: string; value: string; slug: string }[]>("/short-links");
  const syncUrl = (cat: string, cen: string) => {
    if (Platform.OS !== "web" || typeof window === "undefined" || seriesFilter) return;
    const slugOf = (kind: string, v: string) => links.data?.find((l) => l.kind === kind && l.value === v)?.slug;
    let url = "/courses";
    if (cat !== ALL && cen !== ALL) url = `/courses?center=${encodeURIComponent(cen)}&category=${encodeURIComponent(cat)}`;
    else if (cen !== ALL) url = slugOf("center", cen) ? `/${slugOf("center", cen)}` : `/courses?center=${encodeURIComponent(cen)}`;
    else if (cat !== ALL) url = slugOf("category", cat) ? `/${slugOf("category", cat)}` : `/courses?category=${encodeURIComponent(cat)}`;
    window.history.replaceState(window.history.state, "", url);
  };
  // 用下拉選了某個分類：課程呈現自動跳到「單元」（章節）模式；回到「全部分類」就恢復原本的模式。
  const [modeBeforeCat, setModeBeforeCat] = useState<CourseViewMode | null>(null);
  const pickCategory = (vs: string[]) => {
    setSelCats(vs);
    if (vs.length && mode !== "chapter") {
      setModeBeforeCat(mode);
      setMode("chapter");
      setFlashTick((t) => t + 1);
    } else if (!vs.length && modeBeforeCat) {
      setMode(modeBeforeCat);
      setModeBeforeCat(null);
      setFlashTick((t) => t + 1);
    }
    syncUrl(vs.join("、"), vs.length ? ALL : center);
  };
  const pickCenter = (v: string) => {
    setCenter(v);
    syncUrl(category, v);
  };
  const [newOpen, setNewOpen] = useState(false);
  const [artOpen, setArtOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [boxW, setBoxW] = useState(0);
  // 搜尋：放大鏡展開後，每打一個字就即時過濾下方清單並列出關聯詞；搜尋時不受分類限制。
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState("");
  // 顯示模式：系列（封面牆）／章節（一堂一列）；記住上次的選擇。
  const [mode, setMode] = useState<CourseViewMode>("series");
  useEffect(() => {
    AsyncStorage.getItem(MODE_KEY)
      .then((v) => (v === "chapter" || v === "series" || v === "center") && !initialCenter && setMode(v))
      .catch(() => undefined);
  }, []);
  const [flashTick, setFlashTick] = useState(0);
  const pickMode = (m: CourseViewMode) => {
    // 已在中心模式又按一次中心鈕＝回到中心清單。
    if (m === "center" && mode === "center" && center !== ALL) {
      pickCenter(ALL);
      return;
    }
    setMode(m);
    setFlashTick((t) => t + 1);
    syncUrl(category, m === "center" ? center : ALL);
    if (m === "chapter") {
      setWantIndex(true);
      setShuffleSeed(Math.floor(Math.random() * 2 ** 31)); // 切到章節模式就重新洗牌
    }
    AsyncStorage.setItem(MODE_KEY, m).catch(() => undefined);
  };
  const [rowW, setRowW] = useState(0);
  const [wantIndex, setWantIndex] = useState(false);
  const chapterMode = mode === "chapter" && !seriesFilter;
  const searchData = useApi<{ lessons: SearchLesson[] }>(wantIndex || chapterMode ? "/search-index" : null);
  const { c } = useTheme();
  const { config } = useUiConfig();
  // 公開清單只取「已上架」（學習中用的下架封存課程不放這裡）；管理者再加上自己能管的未上架課程。
  const merged = useMemo(() => {
    const pub = (data ?? []).filter((x) => x.status === "published");
    const ids = new Set(pub.map((x) => x.id));
    return [...pub, ...(adminList.data ?? []).filter((x) => x.status === "draft" && !ids.has(x.id))];
  }, [data, adminList.data]);
  const courses = useMemo(() => sortCourses(merged, member, config.sortGroups), [merged, member, config.sortGroups]);
  // 分類下拉＝「關鍵字管理」的分類清單（同步，沒有課程使用的分類也要列出）；載入前先用課程上出現過的分類。
  // 「地區教育中心」不放進下拉（業主 2026-11-15）；課程上的這個標籤仍保留，只是不當篩選項目。
  const categoryList = useApi<string[]>("/categories");
  // 每個分類的統計：課程數、我「學習中」（已開通）幾門、未上架幾門（管理者才看得到未上架的課）、最近 7 天有沒有新增的課程。
  const catStats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const stats = new Map<string, { n: number; learning: number; draft: number; fresh: boolean }>();
    const names = new Set([...(categoryList.data ?? []), ...courses.flatMap(cats), ...(courses.some((x) => !cats(x).length) ? [NONE] : [])]);
    for (const name of names) {
      if (!name || name === HIDDEN_CATEGORY) continue;
      const mine = courses.filter((x) => (name === NONE ? !cats(x).length : cats(x).includes(name)));
      stats.set(name, {
        n: mine.length,
        learning: mine.filter((x) => x.enrollment === "opened").length,
        draft: mine.filter((x) => x.status === "draft").length,
        fresh: mine.some((x) => x.createdAt && Date.parse(x.createdAt) >= weekAgo),
      });
    }
    return stats;
  }, [courses, categoryList.data]);
  // 課程數最多的排最前面（同數量依名稱），與「寰宇教育中心」清單一致。
  const categories = useMemo(() => [...catStats.keys()].sort((a, b) => Number(a === NONE) - Number(b === NONE) || catStats.get(b)!.n - catStats.get(a)!.n || a.localeCompare(b, "zh-Hant")), [catStats]);
  const categoryOption = (x: string): SelectOption => {
    const st = catStats.get(x)!;
    const badges: SelectBadge[] = [];
    if (st.learning) badges.push({ text: `學習中 ${st.learning}`, tone: "accent" });
    if (manager && st.draft) badges.push({ text: `未上架 ${st.draft}`, tone: "warn" });
    if (st.fresh) badges.push({ text: "新", tone: "new" });
    return { key: x, label: x === NONE ? "未分類" : x, hint: `${st.n} 門`, badges };
  };
  const allOption: SelectOption = {
    key: ALL,
    label: "全部分類",
    short: "分類",
    hint: `${courses.length} 門`,
    badges: courses.some((x) => x.enrollment === "opened") ? [{ text: `學習中 ${courses.filter((x) => x.enrollment === "opened").length}`, tone: "accent" }] : [],
  };
  // 中心：課程的主辦中心（名稱都是會員中心清單裡的）；管理者另外加上自己能管的中心（還沒有課程也能先上傳 EDM）。
  const rights = member?.courseRights;
  const centers = useMemo(() => {
    const set = new Set(courses.map((x) => x.hostCenter).filter(Boolean));
    if (rights?.center) set.add(rights.center);
    if (rights?.all) for (const a of centerArt.data ?? []) set.add(a.center);
    return [...set].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [courses, rights, centerArt.data]);
  // 中心只在「中心模式」才篩選；其他模式一律看全部中心。
  const activeCenter = mode === "center" ? center : ALL;
  const inCategory = (x: CourseSummary) => matchesCats(x, selCats);
  // 中心清單的排序：課程數最多的排最前面（同數量依名稱）。
  const centerCounts = useMemo(
    () =>
      centers
        .map((name) => ({ name, count: courses.filter((x) => x.hostCenter === name && inCategory(x)).length }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hant")),
    [centers, courses, category],
  );
  const art = activeCenter !== ALL ? centerArt.data?.find((a) => a.center === activeCenter) : undefined;
  const canEditArt = activeCenter !== ALL && !!rights && (rights.all || (rights.center === activeCenter && (rights.manageEditors || !!rights.editor?.editOthers)));
  const archived = (adminList.data ?? []).filter((x) => x.status === "archived" && (activeCenter === ALL || x.hostCenter === activeCenter));
  const inCenter = (x: CourseSummary) => activeCenter === ALL || x.hostCenter === activeCenter;
  const needIndex = wantIndex || chapterMode;
  const searchIndex = useMemo(() => (needIndex ? buildSearchIndex(courses, searchData.data?.lessons ?? []) : null), [needIndex, courses, searchData.data]);
  const matched = searchIndex && !seriesFilter ? matchCourses(searchIndex, q) : null;
  const terms = searchIndex && q.trim() && q !== picked ? suggestTerms(searchIndex, q) : [];
  // 「相同系列」模式不放地區教育中心的課程（它們在「寰宇教育中心」模式看；業主 2026-11-15）。搜尋時不受此限。
  const hideCenterCourses = mode === "series" && !seriesFilter;
  const list = courses.filter((x) => (matched ? matched.has(x.id) : !(hideCenterCourses && x.category.split("、").includes(HIDDEN_CATEGORY)) && inCategory(x) && inCenter(x) && (!seriesFilter || x.series === seriesFilter)));
  const pickTerm = (text: string) => {
    const head = q.trim().split(/\s+/).slice(0, -1).join(" ");
    const next = head ? `${head} ${text}` : text;
    setQ(next);
    setPicked(next);
  };
  // 選了某個中心：該中心的課程一門一張平鋪，同系列也不合併（業主 2026-11-15）。
  const flat = mode === "center" && center !== ALL;
  const groups = useMemo(
    () => (flat ? list.map((x) => ({ key: `c:${x.id}`, nearest: x, sessions: [x] })) : orderGroups(groupBySeries(list, courses), config.seriesOrder ?? [])),
    [flat, list, courses, config.seriesOrder],
  );
  // 章節模式：符合條件的章節，不分組、不顯示系列標題，順序隨機（每次打開頁面、切到章節模式就重新洗牌；
  // 同一次瀏覽中打字搜尋、換分類時，相對順序保持不變，畫面不會跳動）。
  const [shuffleSeed, setShuffleSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const chapterItems = useMemo<ChapterItem[]>(() => {
    if (!chapterMode) return [];
    const byId = new Map(courses.map((x) => [x.id, x]));
    const hit = searchIndex ? matchLessons(searchIndex, q) : null;
    const canWatch = (x: (typeof courses)[number]) => member?.role === "admin" || x.enrollment === "opened" || x.isPublic || x.watchFree;
    const rand = (id: string) => {
      let h = shuffleSeed | 0;
      for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 2654435761);
      return (h ^ (h >>> 15)) >>> 0;
    };
    const out: ChapterItem[] = [];
    for (const l of searchData.data?.lessons ?? []) {
      const co = byId.get(l.courseId);
      if (!co) continue;
      if (hit ? !hit.has(l.id) : !inCategory(co) || !inCenter(co)) continue;
      out.push({ lesson: l, course: co, locked: !canWatch(co) });
    }
    return out.sort((a, b) => rand(a.lesson.id) - rand(b.lesson.id));
  }, [chapterMode, courses, searchData.data, searchIndex, q, category, activeCenter, member, shuffleSeed]); // eslint-disable-line react-hooks/exhaustive-deps
  // 一排放幾張：手機 2 張，寬一點的畫面 3 張，同一頁容納更多。
  const cols = boxW >= 520 ? 3 : 2;
  const tileW = boxW ? Math.floor((boxW - GAP * (cols - 1)) / cols) : 0;
  // 系列單頁（顯示全部）時，分類下拉顯示這個系列所屬的分類（有多個分類就顯示「全部分類」）；改選別的分類就離開系列頁。
  const seriesCats = seriesFilter ? [...new Set(courses.filter((x) => x.series === seriesFilter).flatMap((x) => x.category.split("、")).filter(Boolean))] : [];
  const shownCategory = seriesCats.length === 1 ? seriesCats[0]! : ALL;
  const leaveSeries = (v: string) => {
    const slug = v === ALL ? null : links.data?.find((l) => l.kind === "category" && l.value === v)?.slug;
    if (slug) router.replace(`/${slug}`);
    else router.replace(v === ALL ? "/courses" : { pathname: "/courses", params: { category: v } });
  };
  const filterRow = (
    <View>
    <View style={styles.filters} onLayout={(e) => setRowW(Math.floor(e.nativeEvent.layout.width))}>
      {!seriesFilter ? <View style={{ width: SEARCH_ICON_W }} /> : null}
      <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", gap: space.sm, opacity: searchOpen ? 0 : 1 }} pointerEvents={searchOpen ? "none" : "auto"}>
      <View style={{ flex: 1 }}>
        {seriesFilter ? (
          <Select value={shownCategory} options={[allOption, ...categories.map(categoryOption)]} onChange={leaveSeries} />
        ) : (
          <CategoryFilterBox picked={selCats} onOpen={() => setCatOpen(true)} onClear={() => pickCategory([])} />
        )}
      </View>
      {!seriesFilter ? <ViewToggle value={mode} onChange={pickMode} /> : null}
      </View>
      {!seriesFilter ? (
        <SearchBox
          open={searchOpen}
          onOpen={() => (setWantIndex(true), setSearchOpen(true))}
          onClose={() => (setSearchOpen(false), setQ(""), setPicked(""))}
          value={q}
          onChange={(v) => (setQ(v), setPicked(""))}
          rowWidth={rowW}
        />
      ) : null}
    </View>
    {!seriesFilter && selCats.length ? <CategoryHintBar picked={selCats} total={courses.filter((x) => inCategory(x) && inCenter(x)).length} onRefine={() => setCatOpen(true)} /> : null}
    {terms.length ? (
      <View style={[styles.terms, { backgroundColor: c.surface, borderColor: c.border }]}>
        {terms.map((t) => (
          <Pressable key={`${t.kind}:${t.text}`} accessibilityRole="button" accessibilityLabel={`${t.kind} ${t.text}`} onPress={() => pickTerm(t.text)} style={[styles.term, { borderBottomColor: c.border }]}>
            <View style={[styles.kind, { backgroundColor: c.accentSoft }]}>
              <AppText variant="caption" style={{ color: c.accentText, fontWeight: "700" }}>
                {t.kind}
              </AppText>
            </View>
            <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
              {t.text}
            </AppText>
          </Pressable>
        ))}
      </View>
    ) : null}
    </View>
  );
  // 系列單頁：只列該系列，每一梯都展開成完整課程卡，順序與梯次選單相同（日期由遠到近）。
  if (seriesFilter) {
    const all = farToNear(courses.filter((x) => x.series === seriesFilter));
    return (
      <Screen header={!inStack} top={filterRow}>
        {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
        {loading && !data ? <LoadingView /> : null}
        {data && !all.length ? <EmptyState icon="library-outline" title="這個系列目前沒有課程" /> : null}
        {all.map((x) => (
          <CourseCard key={x.id} course={x} />
        ))}
      </Screen>
    );
  }
  const centerHead =
    activeCenter !== ALL ? (
      <View style={{ gap: space.sm }}>
        {art ? <EdmImageStage url={art.edmUrl} title={center} /> : null}
        {canEditArt ? <Button variant="secondary" label={art ? "編輯中心 EDM" : "上傳中心 EDM"} icon="create-outline" onPress={() => setArtOpen(true)} fullWidth /> : null}
      </View>
    ) : null;
  const archivedBlock =
    manager && archived.length ? (
      <View style={{ gap: space.sm }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showArchived }} onPress={() => setShowArchived(!showArchived)} style={[styles.archHead, { borderColor: c.border }]}>
          <Ionicons name={showArchived ? "chevron-down" : "chevron-forward"} size={20} color={c.textMuted} />
          <AppText variant="body" tone="muted">
            已封存（{archived.length}）
          </AppText>
        </Pressable>
        {showArchived ? (
          <Card style={{ paddingVertical: 0 }}>
            {archived.map((x) => (
              <ListRow key={x.id} icon="archive-outline" title={x.title} subtitle={[x.hostCenter, x.eventStart ?? ""].filter(Boolean).join("・")} onPress={() => router.push(`/course/${x.id}`)} />
            ))}
          </Card>
        ) : null}
      </View>
    ) : null;
  const shortLink = activeCenter !== ALL ? links.data?.find((l) => l.kind === "center" && l.value === activeCenter) : undefined;
  return (
    <View style={{ flex: 1 }}>
    <Screen header={!inStack} top={filterRow}>
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingView /> : null}
      {centerHead}
      {chapterMode ? (
        <>
          {data && searchData.loading && !searchData.data ? <LoadingView /> : null}
          {data && searchData.data && !chapterItems.length ? <EmptyState icon="library-outline" title={q.trim() ? "找不到符合的章節" : "沒有符合條件的章節"} /> : null}
          <ChapterList items={chapterItems} />
        </>
      ) : (
        <>
          {data && !groups.length && !(mode === "center" && center === ALL) ? <EmptyState icon="library-outline" title={matched ? "找不到符合的課程" : "沒有符合條件的課程"} /> : null}
          <View style={styles.grid} onLayout={(e) => setBoxW(Math.floor(e.nativeEvent.layout.width))}>
            {tileW && mode === "center" && center === ALL
              ? centerCounts.map(({ name, count }) => <CenterTile key={name} name={name} edmUrl={centerArt.data?.find((a) => a.center === name)?.edmUrl} count={count} width={tileW} onPress={() => pickCenter(name)} />)
              : null}
            {tileW && !(mode === "center" && center === ALL) ? groups.map((g) => <SeriesTile key={g.key} group={g} width={tileW} flat={flat} />) : null}
          </View>
        </>
      )}
      {archivedBlock}
      {canCreateCourse(member) ? <View style={{ height: 64 }} /> : null}
    </Screen>
    {canCreateCourse(member) ? (
      <Pressable accessibilityRole="button" accessibilityLabel="新增課程" onPress={() => setNewOpen(true)} style={[styles.fab, { backgroundColor: c.accent }]}>
        <Ionicons name="add" size={26} color={c.textOnAccent} />
        <AppText variant="headline" style={{ color: c.textOnAccent }}>
          新增課程
        </AppText>
      </Pressable>
    ) : null}
    <ModeFlash mode={mode} tick={flashTick} />
    {catOpen ? <CategorySheet courses={courses.filter(inCenter)} names={categories} picked={selCats} onApply={pickCategory} onClose={() => setCatOpen(false)} /> : null}
    {newOpen ? <NewCourseSheet onClose={() => setNewOpen(false)} defaultCenter={activeCenter !== ALL ? activeCenter : undefined} /> : null}
    {artOpen && activeCenter !== ALL ? (
      <EditSheet title={`${activeCenter}的 EDM`} onClose={() => setArtOpen(false)} hideSave>
        <CenterEdm center={activeCenter} edmUrl={art?.edmUrl} onChanged={centerArt.reload} />
        {isSuperAdmin(member) ? <ShortLinkRow key={shortLink?.slug ?? "none"} item={{ kind: "center", value: activeCenter, slug: shortLink?.slug ?? null }} onChanged={links.reload} /> : null}
      </EditSheet>
    ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  terms: { marginTop: space.xs, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  term: { minHeight: 44, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center", gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  kind: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }, filters: { flexDirection: "row", alignItems: "flex-end", gap: space.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP, rowGap: space.lg },
  archHead: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouch, paddingHorizontal: space.md, borderWidth: 1, borderStyle: "dashed", borderRadius: radius.md },
  fab: { position: "absolute", right: space.lg, bottom: space.lg, flexDirection: "row", alignItems: "center", gap: 6, minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.pill, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
});
