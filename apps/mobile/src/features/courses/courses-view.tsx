import { router, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, BackHandler, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api, type CenterArt, type CourseSummary } from "@/api/client";
import { CenterEdm } from "@/features/admin/center-edm";
import { CenterAddressField } from "@/features/admin/center-address-field";
import { CenterNameField } from "@/features/admin/center-name-field";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { AddMaterialFab, type AddKind } from "@/features/course-edit/add-material-fab";
import { NewCourseSheet } from "@/features/course-edit/new-course";
import { centerTitle } from "@/features/format";
import { canCreateCourse, canManageCourses } from "@/lib/roles";
import { HeaderShare } from "@/features/share-button";
import { useCenterNames } from "@/state/center-names";
import { SeriesTile } from "./series-tile";
import { CategoryFilterBox, CategorySheet, NONE, courseCats as cats, lessonsOf, matchesCats } from "./category-sheet";
import { CenterAddress, CenterHero, centerHeroFull } from "./center-hero";
import { CenterTile } from "./center-tile";
import { parseUnitFilter, UnitFilter, unitFilterPass, type UnitFilterValue } from "./unit-filter";
import { flashMode } from "./mode-flash";
import { ViewToggle, type CourseViewMode } from "./view-toggle";
import { ChapterList, type ChapterItem } from "./chapter-list";
import { buildSearchIndex, matchCourses, matchLessons, suggestTerms, type SearchLesson } from "./course-search";
import { SEARCH_ICON_W, SearchBox } from "./search-box";
import { groupBySeries, orderGroups, sortCourses } from "./sort";
import { useApi, useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Card, EmptyState, ErrorView, ListRow, LoadingView, Screen, TopBar, TopBarButton } from "@/ui";

const ALL = "";
const MODE_KEY = "hglobal:learn:course-view-mode";
const UNIT_FILTER_KEY = "hglobal:learn:unit-filter";
const OLD_SPEAKER_KEY = "hglobal:learn:speaker-only";
const GAP = space.md;

/**
 * 全部課程清單。initialCategory／initialCenter／series 由網址（短網址、?category=、?center=、?series=）帶入。
 * 「中心」下拉：選了中心，下方先顯示該中心的 EDM（有上傳才有），只列該中心主辦的課程。
 * 管理者（總部、會長、音控、小編）另外看得到自己能管的「未上架」課程（標示未上架）、最下面可展開「已封存」、右下角「＋新增教材」（往上展開：新增課程／新增清單）。
 */
export function CoursesView({ initialCategory = "", initialCenter = "", inStack = false, initialCenters = false }: { initialCategory?: string; initialCenter?: string; inStack?: boolean; /** /courses?view=centers：直接打開「所有中心」清單。 */ initialCenters?: boolean }) {
  const { data, error, loading, reload } = useApi<CourseSummary[]>("/courses");
  const { member } = useSession();
  useCenterNames(); // 中心名稱有更新時重新畫
  const manager = canManageCourses(member);
  const adminList = useApi<CourseSummary[]>(manager ? "/admin/courses" : null);
  const centerArt = useApi<CenterArt[]>("/center-art");
  const centerInfo = useApi<Record<string, string>>(member ? "/center-info" : null); // 各中心地址（中心沒有課程時的提示用）
  // 已選的分類（可複選；多個＝同時有這些分類）。空陣列＝全部分類。
  const [selCats, setSelCats] = useState<string[]>(initialCategory ? initialCategory.split("、").filter(Boolean) : []);
  const category = selCats.join("、");
  const [catOpen, setCatOpen] = useState(false);
  const [center, setCenter] = useState(initialCenter || ALL);
  useEffect(() => {
    if (initialCategory) setSelCats(initialCategory.split("、").filter(Boolean));
  }, [initialCategory]);
  useEffect(() => {
    if (initialCenter) {
      setCenter(initialCenter);
      setMode("center"); // 從課程卡的「XX主辦」或中心短網址進來＝直接看該中心
    } else if (initialCenters) {
      setCenter(ALL);
      setMode("center"); // 從中心專屬頁返回（直接從分享網址進來的情況）＝所有中心的清單
    }
  }, [initialCenter, initialCenters]);
  // 網頁：網址列跟著篩選變：只選分類或只選中心＝該短網址（有設定才換）；兩個都選＝/courses?center=…&category=…；都沒選＝/courses。
  const links = useApi<{ kind: string; value: string; slug: string }[]>("/short-links");
  const urlFor = (cat: string, cen: string) => {
    const slugOf = (kind: string, v: string) => links.data?.find((l) => l.kind === kind && l.value === v)?.slug;
    let url = "/courses";
    if (cat !== ALL && cen !== ALL) url = `/courses?center=${encodeURIComponent(cen)}&category=${encodeURIComponent(cat)}`;
    else if (cen !== ALL) url = slugOf("center", cen) ? `/${slugOf("center", cen)}` : `/courses?center=${encodeURIComponent(cen)}`;
    else if (cat !== ALL) url = slugOf("category", cat) ? `/${slugOf("category", cat)}` : `/courses?category=${encodeURIComponent(cat)}`;
    return url;
  };
  const syncUrl = (cat: string, cen: string) => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    window.history.replaceState(window.history.state, "", urlFor(cat, cen));
  };
  // 用下拉選了某個分類：課程呈現自動跳到「單元」（章節）模式；回到「全部分類」就恢復原本的模式。
  const [modeBeforeCat, setModeBeforeCat] = useState<CourseViewMode | null>(null);
  const pickCategory = (vs: string[]) => {
    setSelCats(vs);
    if (vs.length && mode !== "chapter") {
      setModeBeforeCat(mode);
      setMode("chapter");
      flashMode("chapter", c.accent);
    } else if (!vs.length && modeBeforeCat) {
      setMode(modeBeforeCat);
      flashMode(modeBeforeCat, c.accent);
      setModeBeforeCat(null);
    }
    syncUrl(vs.join("、"), vs.length ? ALL : center);
  };
  const pickCenter = (v: string) => {
    setCenter(v);
    syncUrl(category, v);
  };
  const [newOpen, setNewOpen] = useState<AddKind | null>(null);
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
      .then((v) => (v === "chapter" || v === "series" || v === "center") && !initialCenter && !initialCenters && setMode(v))
      .catch(() => undefined);
  }, []);
  // 「單元」模式的三個勾選篩選（主講人／短影音／總結；短影音不能與另外兩個並存）：記住上次的選擇；舊版「只顯示主講人」的設定轉成「只看主講」。
  const [unitFilter, setUnitFilter] = useState<UnitFilterValue>("all");
  useEffect(() => {
    AsyncStorage.multiGet([UNIT_FILTER_KEY, OLD_SPEAKER_KEY])
      .then(([[, v], [, old]]) => setUnitFilter(v ? parseUnitFilter(v) : old === "1" ? "speaker" : "all"))
      .catch(() => undefined);
  }, []);
  const pickUnitFilter = (v: UnitFilterValue) => {
    setUnitFilter(v);
    AsyncStorage.setItem(UNIT_FILTER_KEY, v).catch(() => undefined);
  };
  const pickMode = (m: CourseViewMode) => {
    // 已在中心模式又按一次中心鈕＝回到中心清單。
    if (m === "center" && mode === "center" && center !== ALL) {
      pickCenter(ALL);
      return;
    }
    setMode(m);
    flashMode(m, c.accent);
    syncUrl(category, m === "center" ? center : ALL);
    if (m === "chapter") {
      setWantIndex(true);
      setShuffleSeed(Math.floor(Math.random() * 2 ** 31)); // 切到章節模式就重新洗牌
    }
    AsyncStorage.setItem(MODE_KEY, m).catch(() => undefined);
  };
  const [rowW, setRowW] = useState(0);
  const [wantIndex, setWantIndex] = useState(false);
  const chapterMode = mode === "chapter";
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
  // 兩頁內容互不重複（業主 2026-11-15）：「寰宇教育中心」頁只有「中心課程」，「相同系列」「單元」只有一般課程。
  // 「寰宇教育中心」頁＝主辦單位含中心的課程；「相同系列」「單元」＝總部主辦的課程，加上所有有指定「系列」標籤的課程（不論主辦單位）。
  const pool = useMemo(() => courses.filter((x) => (mode === "center" ? !!x.centerCourse : !x.centerCourse || !!x.series?.trim())), [courses, mode]);
  // 分類下拉＝「關鍵字管理」的分類清單（同步，沒有課程使用的分類也要列出）；載入前先用課程上出現過的分類。
  // 「地區教育中心」不放進下拉（業主 2026-11-15）；課程上的這個標籤仍保留，只是不當篩選項目。
  const categoryList = useApi<string[]>("/categories");
  // 每個分類的統計（數字一律是章節＝堂數，不是課程數；業主 2026-11-15）：全部幾堂、我「學習中」（已開通）幾堂、未上架幾堂（管理者才看得到未上架的課）、最近 7 天有沒有新增的課程。
  const catStats = useMemo(() => {
    const weekAgo = Date.now() - config.app.freshDays * 24 * 3600 * 1000; // 「新」標籤：幾天內建立（設定 > APP 數值設定）
    const stats = new Map<string, { n: number; learning: number; draft: number; fresh: boolean }>();
    // 清單項目與順序在所有模式一致（業主 2026-11-15）：來源＝關鍵字管理的分類清單＋所有課程用過的分類，「未分類」固定列在最後；數字（堂數）也一律是全站總堂數，三個模式完全相同。
    const names = new Set([...(categoryList.data ?? []), ...courses.flatMap(cats), NONE]);
    for (const name of names) {
      if (!name) continue;
      const mine = courses.filter((x) => (name === NONE ? !cats(x).length : cats(x).includes(name)));
      stats.set(name, {
        n: lessonsOf(mine),
        learning: lessonsOf(mine.filter((x) => x.enrollment === "opened")),
        draft: lessonsOf(mine.filter((x) => x.status === "draft")),
        fresh: mine.some((x) => x.createdAt && Date.parse(x.createdAt) >= weekAgo),
      });
    }
    return stats;
  }, [courses, categoryList.data, config.app.freshDays]);
  // 順序：以「全部課程」的堂數由多到少（同數量依名稱），與目前是哪個模式無關，所以每個模式的清單順序都一樣；「未分類」固定最後。
  const categories = useMemo(() => {
    const total = (name: string) => lessonsOf(courses.filter((x) => (name === NONE ? !cats(x).length : cats(x).includes(name))));
    const weight = new Map([...catStats.keys()].map((k) => [k, total(k)]));
    return [...catStats.keys()].sort((a, b) => Number(a === NONE) - Number(b === NONE) || weight.get(b)! - weight.get(a)! || a.localeCompare(b, "zh-Hant"));
  }, [catStats, courses]);
  // 中心清單：只以會員中心（中央）為準，每個中心都列出，沒有中心課程的顯示 0 堂（業主 2026-11-15）；不混入本地資料。
  const rights = member?.courseRights;
  const centerList = useApi<string[]>(member ? "/centers" : null);
  const centers = centerList.data ?? [];
  const normCenter = (v: string) => v.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  // 中心只在「中心模式」才篩選；其他模式一律看全部中心。
  const activeCenter = mode === "center" ? center : ALL;
  const inCategory = (x: CourseSummary) => matchesCats(x, selCats);
  // 中心清單的排序（業主 2026-11-16）：依「課程數」由多到少，但只計算「有上傳教材」的課程（影音來源或附件）；同數量依名稱。
  const centerCounts = useMemo(
    () =>
      centers
        .map((name) => ({ name, count: courses.filter((x) => x.centerCourse && x.hasMaterial && normCenter(x.hostCenter) === normCenter(name) && inCategory(x)).length }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hant")),
    [centers, courses, category], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const art = activeCenter !== ALL ? centerArt.data?.find((a) => a.center === activeCenter) : undefined;
  const canEditArt = activeCenter !== ALL && !!rights && (rights.all || (rights.center === activeCenter && (rights.manageEditors || !!rights.editor?.editOthers)));
  const archived = (adminList.data ?? []).filter((x) => x.status === "archived" && (activeCenter === ALL || normCenter(x.hostCenter) === normCenter(activeCenter)));
  const inCenter = (x: CourseSummary) => activeCenter === ALL || normCenter(x.hostCenter) === normCenter(activeCenter);
  const needIndex = wantIndex || chapterMode;
  const searchIndex = useMemo(() => (needIndex ? buildSearchIndex(courses, searchData.data?.lessons ?? []) : null), [needIndex, courses, searchData.data]);
  const matched = searchIndex ? matchCourses(searchIndex, q) : null;
  const terms = searchIndex && q.trim() && q !== picked ? suggestTerms(searchIndex, q) : [];
  // 搜尋時不受兩頁分流限制（搜得到所有課程）；其餘只看目前這一頁的課程。
  const list = (matched ? courses : pool).filter((x) => (matched ? matched.has(x.id) : inCategory(x) && inCenter(x) ));
  const pickTerm = (text: string) => {
    const head = q.trim().split(/\s+/).slice(0, -1).join(" ");
    const next = head ? `${head} ${text}` : text;
    setQ(next);
    setPicked(next);
  };
  // 選了某個中心：該中心的課程一門一張平鋪，同系列也不合併（業主 2026-11-15）。
  const flat = mode === "center" && center !== ALL;
  const groups = useMemo(
    () => (flat ? list.map((x) => ({ key: `c:${x.id}`, nearest: x, sessions: [x] })) : orderGroups(groupBySeries(list, pool), config.seriesOrder ?? [])),
    [flat, list, pool, config.seriesOrder],
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
      if (hit ? !hit.has(l.id) : !inCategory(co) || !inCenter(co)) continue; // 單元頁顯示全部課程（含中心課程）
      if (!unitFilterPass(unitFilter, l)) continue;
      out.push({ lesson: l, course: co, locked: !canWatch(co) });
    }
    return out.sort((a, b) => rand(a.lesson.id) - rand(b.lesson.id));
  }, [chapterMode, courses, searchData.data, searchIndex, q, category, activeCenter, member, shuffleSeed, unitFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  // 一排放幾張：手機 2 張，寬一點的畫面 3 張，同一頁容納更多。
  const cols = flat ? 3 : boxW >= 520 ? 3 : 2; // 中心頁的直式 EDM 卡一列三張
  const tileW = boxW ? Math.floor((boxW - GAP * (cols - 1)) / cols) : 0;
  const filterRow = (
    <View>
    <View style={styles.filters} onLayout={(e) => setRowW(Math.floor(e.nativeEvent.layout.width))}>
      <View style={{ width: SEARCH_ICON_W }} />
      <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", gap: space.sm, opacity: searchOpen ? 0 : 1 }} pointerEvents={searchOpen ? "none" : "auto"}>
      <View style={{ flex: 1 }}>
        <CategoryFilterBox picked={selCats} total={lessonsOf(courses.filter(inCategory))} onOpen={() => setCatOpen(true)} onClear={() => pickCategory([])} />
      </View>
      <ViewToggle value={mode} onChange={pickMode} />
      </View>
        <SearchBox
          open={searchOpen}
          onOpen={() => (setWantIndex(true), setSearchOpen(true))}
          onClose={() => (setSearchOpen(false), setQ(""), setPicked(""))}
          value={q}
          onChange={(v) => (setQ(v), setPicked(""))}
          rowWidth={rowW}
        />
    </View>
    {chapterMode ? <UnitFilter value={unitFilter} onChange={pickUnitFilter} /> : null}
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
  // 中心專屬頁：網頁進入時多記一筆瀏覽紀錄，瀏覽器／手機的「返回」＝回到中心清單；Android 實體返回鍵同理。
  const pushedRef = useRef(false);
  const centerUrlRef = useRef(""); // 記下「中心頁」那一筆紀錄的網址
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    if (activeCenter !== ALL && !pushedRef.current) {
      // 先把目前這一筆紀錄的網址還原成沒選中心的樣子，再另外記一筆「中心頁」：返回時才不會又被網址帶回中心頁。
      const here = window.location.href;
      // 中心專屬頁的「上一頁」一律＝所有中心的清單（業主 2026-11-17：不論是中心短網址、/courses?center=，或從課程頁返回進來）。
      window.history.replaceState(window.history.state, "", category === ALL ? "/courses?view=centers" : urlFor(category, ALL));
      window.history.pushState({ hgCenter: 1 }, "", here);
      centerUrlRef.current = new URL(here).pathname + new URL(here).search;
      pushedRef.current = true;
    } else if (activeCenter === ALL) pushedRef.current = false;
  }, [activeCenter]);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onPop = () => {
      if (!pushedRef.current) return;
      // 退回到「中心頁」那一筆紀錄（網址還是中心頁的網址，例如從課程頁、上課頁按返回回來）＝還在中心頁，維持目前的中心；
      // 退回到它下面那一筆（網址是沒選中心的清單）才是真的離開中心頁，回到中心清單。
      // 用網址判斷（不用 history.state，因為導覽套件會改寫紀錄的 state）。
      if (window.location.pathname + window.location.search === centerUrlRef.current) {
        // 導覽套件稍後會把網址改回 /courses；等它改完再把網址還原成這個中心。
        setTimeout(() => syncUrl(category, center), 120);
        return;
      }
      pushedRef.current = false;
      pickCenter(ALL);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const backFromCenter = () => {
    if (Platform.OS === "web" && pushedRef.current && typeof window !== "undefined") window.history.back();
    // 中心短網址（獨立頁面）直接從分享網址進來：返回「所有中心」清單（業主 2026-11-17）。
    else if (inStack) (router.canGoBack() ? router.back() : router.replace("/courses?view=centers"));
    else pickCenter(ALL);
  };
  // Android 實體返回鍵：只在這個畫面是目前畫面（焦點）、而且選了中心時才攔截；課程頁蓋在上面時不攔，讓它正常返回。
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === "web" || activeCenter === ALL) return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => (pickCenter(ALL), true));
      return () => sub.remove();
    }, [activeCenter]), // eslint-disable-line react-hooks/exhaustive-deps
  );
  // 中心頁上方的照片：透明小標籤「N 門課・N 章節・N 瀏覽」；往上滑時縮成窄橫幅（CenterHero）。
  const scrollY = useRef(new Animated.Value(0)).current;
  const [centerViews, setCenterViews] = useState<number | null>(null);
  useEffect(() => {
    if (activeCenter === ALL || !member) return;
    setCenterViews(null);
    api<{ total: number }>("POST", "/center-views", { center: activeCenter })
      .then((r) => setCenterViews(r.total))
      .catch(() => undefined);
  }, [activeCenter, member?.sub]); // eslint-disable-line react-hooks/exhaustive-deps
  const heroCourses = activeCenter !== ALL ? courses.filter((x) => x.status === "published" && x.centerCourse && normCenter(x.hostCenter) === normCenter(activeCenter)) : [];
  const centerHero =
    activeCenter !== ALL ? <CenterHero art={art} scrollY={scrollY} courses={heroCourses.length} lessons={lessonsOf(heroCourses)} views={centerViews} title={centerTitle(activeCenter)} /> : undefined;
  const centerAddress = activeCenter !== ALL ? centerInfo.data?.[normCenter(activeCenter)] : undefined;
  const { width: winWidth } = useWindowDimensions();
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
              <ListRow key={x.id} icon="archive-outline" title={x.title} subtitle={[x.hostCenter ? centerTitle(x.hostCenter) : "", x.eventStart ?? ""].filter(Boolean).join("・")} onPress={() => router.push(`/course/${x.id}`)} />
            ))}
          </Card>
        ) : null}
      </View>
    ) : null;
  const shortLink = activeCenter !== ALL ? links.data?.find((l) => l.kind === "center" && l.value === activeCenter) : undefined;
  return (
    <View style={{ flex: 1 }}>
    <Screen header={!inStack && activeCenter === ALL} topBar={activeCenter !== ALL ? <TopBar safeTop shadow title={centerTitle(activeCenter)} onBack={backFromCenter} right={
            <>
              {canEditArt ? <TopBarButton label="編輯" accessibilityLabel="編輯中心 EDM" iconName="create-outline" onPress={() => setArtOpen(true)} /> : null}
              {/* 分享：與其他頁面同一個按鈕與規則（邀請文字＋網址）；有設定短網址就分享短網址，沒有就分享這個中心的網址。 */}
              <HeaderShare title={centerTitle(activeCenter)} path={shortLink ? `/${shortLink.slug}` : `/courses?center=${encodeURIComponent(activeCenter)}`} />
            </>
          } /> : undefined} hero={centerHero} heroHeight={centerHeroFull(winWidth)} scrollY={centerHero ? scrollY : undefined} top={activeCenter === ALL ? filterRow : undefined}>
      {centerAddress ? <CenterAddress address={centerAddress} /> : null}
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingView /> : null}
      {chapterMode ? (
        <>
          {data && searchData.loading && !searchData.data ? <LoadingView /> : null}
          {data && searchData.data && !chapterItems.length ? <EmptyState icon="library-outline" title={q.trim() ? "找不到符合的章節" : "沒有符合條件的章節"} /> : null}
          <ChapterList items={chapterItems} />
        </>
      ) : (
        <>
          {data && !groups.length && !(mode === "center" && center === ALL) ? (
            mode === "center" && !matched && !selCats.length ? (
              // 中心頁完全沒有課程：固定提示文字（地址由中心的編輯面板設定；沒設定就不顯示地址那一行）
              <EmptyState icon="library-outline" title="線上課程準備中" body={["線下課程週週精彩", centerInfo.data?.[normCenter(center)] ? `地址：${centerInfo.data[normCenter(center)]}` : "", "請洽中心負責人"].filter(Boolean).join("\n")} />
            ) : (
              <EmptyState icon="library-outline" title={matched ? "找不到符合的課程" : "沒有符合條件的課程"} />
            )
          ) : null}
          <View style={styles.grid} onLayout={(e) => setBoxW(Math.floor(e.nativeEvent.layout.width))}>
            {tileW && mode === "center" && center === ALL
              ? centerCounts.map(({ name }) => <CenterTile key={name} name={name} edmUrl={(() => { const a = centerArt.data?.find((x) => x.center === name); return a ? a.coverUrl ?? a.edmUrl : undefined; })()} width={tileW} onPress={() => pickCenter(name)} />)
              : null}
            {tileW && !(mode === "center" && center === ALL) ? groups.map((g) => <SeriesTile key={g.key} group={g} width={tileW} flat={flat} />) : null}
          </View>
        </>
      )}
      {archivedBlock}
      {canCreateCourse(member) ? <View style={{ height: 64 }} /> : null}
    </Screen>
    {canCreateCourse(member) ? (
      <AddMaterialFab onPick={setNewOpen} />
    ) : null}
    {catOpen ? <CategorySheet courses={courses} names={categories} picked={selCats} onApply={pickCategory} onClose={() => setCatOpen(false)} /> : null}
    {newOpen ? <NewCourseSheet list={newOpen === "list"} onClose={() => setNewOpen(null)} defaultCenter={activeCenter !== ALL ? activeCenter : undefined} /> : null}
    {artOpen && activeCenter !== ALL ? (
      <EditSheet title={`編輯${centerTitle(activeCenter)}`} onClose={() => setArtOpen(false)} hideSave>
        <CenterNameField key={activeCenter} center={activeCenter} />
        <CenterAddressField center={activeCenter} current={centerInfo.data?.[normCenter(activeCenter)] ?? ""} onSaved={centerInfo.reload} />
        <CenterEdm center={activeCenter} art={art} onChanged={centerArt.reload} />
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

});
