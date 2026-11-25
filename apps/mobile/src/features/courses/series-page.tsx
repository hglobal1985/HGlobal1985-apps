import { trackFeature } from "@/lib/feature-track";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Switch, useWindowDimensions, View } from "react-native";
import { api, UNCATEGORIZED, type CourseSummary, type SeriesArt } from "@/api/client";
import { SeriesApplySheet, SeriesCoverSheet } from "@/features/admin-parts";
import { BroadcastZone } from "@/features/broadcast/broadcast-zone";
import { BroadcastComposer } from "@/features/broadcast/broadcast-composer";
import { AddMaterialFab } from "@/features/course-edit/add-material-fab";
import { PageHeader } from "@/features/page-header";
import { NewCourseSheet } from "@/features/admin-parts";
import { canCreateCourse, isSuperAdmin } from "@/lib/roles";
import { useApi, useSession } from "@/state/session";
import { portraitColumns, tileColumns } from "@/theme/layout";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Button, Card, EmptyState, ErrorView, Field, LoadingView, LoginPrompt, NoticeBox, Screen, SegmentTabs } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import { TopBarButton } from "@/ui/top-bar";
import { CenterHero, centerHeroFull, HeroMiniCover } from "./center-hero";
import { CoverMiniFloat } from "@/ui/collapse-band";
import { CoverAlbum } from "./album";
import { AlbumUploadButton } from "@/features/uploads/album-upload";
import { useCoverMedia } from "./cover-media";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { CenterListCard } from "./center-list";
import { SeriesCardTile } from "./series-card-tile";
import { SeriesCardPanel } from "./series-card-panel";
import { ExpandGrid } from "./expand-grid";
import { useSeriesSettings } from "./series-settings";
import { seriesOrdered } from "./sort";
import { useCoverStats } from "./cover-stats";

type View_ = "list" | "edm";
const GAP = space.md;

/**
 * 系列單頁（業主 2026-11-19 改版）：照片區（封面圖＋訂閱鈕＋點閱次數）→ 切換「EDM／清單」→
 * 系列裡的「課程卡」與「清單卡」（兩種都有就分兩區）；內容是自動收集的，這裡不能手動新增教材或區塊，點卡片直接進該卡的詳細頁。
 * 超級管理員右上角「編輯」＝編輯模式：系列標題（只改顯示）、是否顯示在「所有系列」、封面圖（直式＋橫式）、
 * 每張卡的 ◀ ▶ 排序與隱藏（隱藏只是不在這個系列頁顯示）。
 */
export function SeriesPage({ series, path }: { series: string; path: string }) {
  const { c } = useTheme();
  const { member } = useSession();
  const admin = isSuperAdmin(member);
  const settings = useSeriesSettings();
  const { data, error, loading, reload } = useApi<CourseSummary[]>("/courses");
  const artList = useApi<SeriesArt[]>("/series-art");
  const adminList = useApi<CourseSummary[]>(member?.courseRights ? "/admin/courses" : null);
  const [view, setView] = useState<View_>("edm"); // 每次進入系列頁一律從「縮圖」開始，不記住上次選擇（業主 2026-11-21）
  const [editing, setEditing] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [albumOpen, setAlbumOpen] = useState(false);
  const cm = useCoverMedia("series", series);
  const [applyOpen, setApplyOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [bcTick, setBcTick] = useState(0);
  const [boxW, setBoxW] = useState(0);
  const scrollY = useRef(new Animated.Value(0)).current;
  const { width: winW, height: winHeight } = useWindowDimensions();
  const shownTitle = settings.titleOf(series);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    trackFeature("series_page");
  }, [series]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => {
    const pub = (data ?? []).filter((x) => x.status === "published" && x.viewScope !== "link_login" && x.viewScope !== "link_guest");
    const ids = new Set(pub.map((x) => x.id));
    return [...pub, ...(adminList.data ?? []).filter((x) => x.status === "draft" && !ids.has(x.id))].filter((x) => x.series === series);
  }, [data, adminList.data, series]);
  // 排序與隱藏：先直接換畫面、背景存檔，失敗還原（業主 2026-11-17 永久指示：編輯動作要瞬間反應）。
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [hiddenOver, setHiddenOver] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setLocalOrder(null);
    setHiddenOver({});
  }, [data]);
  const withHidden = useMemo(() => all.map((x) => (x.id in hiddenOver ? { ...x, seriesHidden: hiddenOver[x.id]! } : x)), [all, hiddenOver]);
  const shown = editing ? withHidden : withHidden.filter((x) => !x.seriesHidden);
  const ordered = (items: CourseSummary[]) => {
    const base = seriesOrdered(items);
    if (!localOrder) return base;
    const pos = new Map(localOrder.map((id, i) => [id, i]));
    return [...base].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
  };
  const courseCards = useMemo(() => ordered(shown.filter((x) => !x.isList)), [shown, localOrder]); // eslint-disable-line react-hooks/exhaustive-deps
  const listCards = useMemo(() => ordered(shown.filter((x) => x.isList)), [shown, localOrder]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (items: CourseSummary[], i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const mine = items.map((x) => x.id);
    [mine[i], mine[j]] = [mine[j]!, mine[i]!];
    const other = (items === courseCards ? listCards : courseCards).map((x) => x.id);
    const ids = items === courseCards ? [...mine, ...other] : [...other, ...mine];
    setLocalOrder(ids);
    api("POST", "/admin/series-order", { series, ids })
      .then(() => reload())
      .catch((e: Error) => {
        setLocalOrder(null);
        flashText(e.message);
      });
  };
  const toggleHide = (x: CourseSummary) => {
    const next = !x.seriesHidden;
    setHiddenOver((o) => ({ ...o, [x.id]: next }));
    api("POST", "/admin/series-hide", { id: x.id, hidden: next })
      .then(() => reload())
      .catch((e: Error) => {
        setHiddenOver((o) => {
          const n = { ...o };
          delete n[x.id];
          return n;
        });
        flashText(e.message);
      });
  };
  const saveSettings = async (body: { title?: string; showInAll?: boolean }, done: string) => {
    setBusy(true);
    try {
      await api("PUT", "/admin/series-settings", { series, ...body });
      settings.reload();
      flashText(done);
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const stats = useCoverStats("series", series, path); // 封面的訂閱鈕與點閱次數（封面統計模組，全站同一套）
  // 分享網址一律用系列短網址（/Beauty-Starry），沒設定才用 /series/名稱（業主 2026-11-17）；網頁版網址列也換成短網址。
  const links = useApi<{ kind: string; value: string; slug: string }[]>("/short-links");
  const slug = links.data?.find((l) => l.kind === "series" && l.value === series)?.slug;
  const sharePath = slug ? `/${slug}` : path;
  useEffect(() => {
    if (Platform.OS === "web" && slug && typeof window !== "undefined" && window.location.pathname !== sharePath) window.history.replaceState(window.history.state, "", sharePath + window.location.search);
  }, [slug, sharePath]);
  const art = artList.data?.find((x) => x.series === series);
  const pick = (v: View_) => setView(v);
  const colsOf = (n: number) => Math.max(1, n);
  const courseCols = colsOf(portraitColumns(boxW)); // 課程卡：直式 3:4，手機一列三張，大螢幕依寬度增加
  const listCols = colsOf(tileColumns(boxW)); // 清單卡：橫式 4:3，手機一列兩張，大螢幕依寬度增加
  const tileW = (cols: number) => (boxW ? Math.floor((boxW - GAP * (cols - 1)) / cols) : 0);
  const hiddenFromMember = series === UNCATEGORIZED && !admin; // 「未分類」只有超級管理員看得到
  const section = (_title: string, _n: number) => null; // 業主 2026-11-20：只剩「教材卡」一種，不再分「課程卡／清單卡」兩區標題（版型仍依內容自動排）
  const ctrl = (items: CourseSummary[], x: CourseSummary, i: number) => (
    <View style={styles.arrows}>
      <Pressable accessibilityRole="button" accessibilityLabel={`上移 ${x.title}`} disabled={i === 0} onPress={() => move(items, i, -1)} style={[styles.arrow, { borderColor: c.border, backgroundColor: c.surface, opacity: i === 0 ? 0.3 : 1 }]}>
        <Ionicons name="arrow-up" size={20} color={c.text} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`下移 ${x.title}`} disabled={i === items.length - 1} onPress={() => move(items, i, 1)} style={[styles.arrow, { borderColor: c.border, backgroundColor: c.surface, opacity: i === items.length - 1 ? 0.3 : 1 }]}>
        <Ionicons name="arrow-down" size={20} color={c.text} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={x.seriesHidden ? `顯示 ${x.title}` : `隱藏 ${x.title}`} onPress={() => toggleHide(x)} style={[styles.arrow, { borderColor: c.border, backgroundColor: c.surface }]}>
        <Ionicons name={x.seriesHidden ? "eye-off-outline" : "eye-outline"} size={20} color={c.accentText} />
      </Pressable>
    </View>
  );
  // 「清單」＝與中心頁「清單」同一個模組 CenterListCard（業主 2026-11-21）；編輯模式右側換成排序／隱藏鈕。
  const listBlock = (_title: string, items: CourseSummary[]) => (items.length ? <CenterListCard courses={items} trailing={editing ? (x, i) => ctrl(items, x, i) : undefined} /> : null);
  const gridBlock = (title: string, items: CourseSummary[], cols: number) =>
    items.length ? (
      <View style={{ gap: space.sm }}>
        {section(title, items.length)}
        {editing ? (
          // 編輯模式：維持原本的排序／隱藏控制，點卡直接進詳細頁
          <View style={styles.grid}>
            {tileW(cols)
              ? items.map((x, i) => <SeriesCardTile key={x.id} course={x} width={tileW(cols)} editing canBack={i > 0} canForward={i < items.length - 1} onMove={(d) => move(items, i, d)} onToggleHide={() => toggleHide(x)} />)
              : null}
          </View>
        ) : (
          // 一般檢視：點一張卡，在那一列下方原地展開它的教材，其他卡淡化（共用 ExpandGrid，業主 2026-11-20）
          <ExpandGrid
            items={items}
            keyOf={(x) => x.id}
            cols={() => cols}
            gap={GAP}
            renderCell={(x, { on, dimmed, toggle, width }) => <SeriesCardTile course={x} width={width} selected={on} dimmed={dimmed} onPress={toggle} />}
            renderPanel={(x) => <SeriesCardPanel course={x} />}
          />
        )}
      </View>
    ) : null;
  return (
    <View style={{ flex: 1 }}>
      <PageHeader
        title={shownTitle}
        addToList={{ kind: "series", ref: series }}
        path={sharePath}
        extra={admin ? <TopBarButton label={editing ? "完成" : "編輯"} accessibilityLabel={editing ? "完成編輯系列" : "編輯系列"} iconName={editing ? "checkmark-circle-outline" : "create-outline"} onPress={() => setEditing((v) => !v)} /> : undefined}
      />
      <Screen wide header={false} hero={<CenterHero art={art} media={cm.items} scrollY={scrollY} stats={stats} title={shownTitle} onEditCover={admin && series !== UNCATEGORIZED ? () => setCoverOpen(true) : undefined} />} heroFooter={<BroadcastZone series={series} title={`${shownTitle}公告`} reloadKey={bcTick} />} heroHeight={centerHeroFull(winW, winHeight)} scrollY={scrollY}>
        {/* 系列公告緊貼封面下方（業主 2026-11-21）；課程頁、各中心頁各有自己的公告橫條。 */}
        <LoginPrompt />
        {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
        {loading && !data ? <LoadingView /> : null}
        {hiddenFromMember ? <EmptyState icon="library-outline" title="找不到這個系列" /> : null}
        {admin && editing ? (
          <Card style={{ gap: space.md }}>
            <AppText variant="headline">編輯系列卡</AppText>
            {series === UNCATEGORIZED ? (
              <NoticeBox tone="info" text="「未分類」放的是還沒指定系列的教材卡，只有超級管理員看得到。把課程的「系列」改成其他系列，它就會移到那個系列。" />
            ) : (
              <>
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="callout" style={{ fontWeight: "700" }}>
                      顯示在「所有系列」
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      關掉後，一般會員在寰宇大學首頁看不到這張系列卡（仍可用網址進入）。
                    </AppText>
                  </View>
                  <Switch value={settings.showInAll(series)} disabled={busy} onValueChange={(v) => saveSettings({ showInAll: v }, v ? "已顯示在所有系列" : "已從所有系列隱藏")} trackColor={{ true: c.accent, false: c.border }} accessibilityLabel="顯示在所有系列" />
                </View>
                <Field label="系列標題（只改顯示的名稱）" value={titleDraft ?? shownTitle} onChange={setTitleDraft} placeholder={series} />
                {titleDraft !== null && titleDraft.trim() !== shownTitle ? <Button label="儲存標題" disabled={busy} onPress={() => saveSettings({ title: titleDraft.trim() === series ? "" : titleDraft.trim() }, "已儲存標題").then(() => setTitleDraft(null))} fullWidth /> : null}
              </>
            )}
            <Button variant="secondary" icon="image-outline" label="封面圖（直式＋橫式）" onPress={() => setCoverOpen(true)} fullWidth />
            <Button variant="secondary" icon="images-outline" label={`封面輪播相簿（${cm.items.length}）`} onPress={() => setAlbumOpen(true)} fullWidth />
            {series !== UNCATEGORIZED ? <Button variant="secondary" icon="copy-outline" label="套用設定到全系列課程" onPress={() => setApplyOpen(true)} fullWidth /> : null}
            <AppText variant="caption" tone="muted">
              下面每張卡可以用 ◀ ▶ 調整順序、用眼睛鈕隱藏（只是不在這個系列頁顯示）。系列裡的卡是自動收集的，不能在這裡新增。
            </AppText>
          </Card>
        ) : null}
        {data && !hiddenFromMember && !all.length ? <EmptyState icon="library-outline" title="這個系列目前沒有內容" /> : null}
        {!hiddenFromMember && shown.length ? (
          <SegmentTabs options={[{ key: "edm", label: "EDM" }, { key: "list", label: "清單" }]} value={view} onChange={pick} />
        ) : null}
        {!hiddenFromMember && view === "list" ? (
          <View style={{ gap: space.md }}>
            {listBlock("課程卡", courseCards)}
            {listBlock("清單卡", listCards)}
          </View>
        ) : null}
        {!hiddenFromMember && view === "edm" ? (
          <View style={{ gap: space.lg }} onLayout={(e) => setBoxW(Math.floor(e.nativeEvent.layout.width))}>
            {gridBlock("課程卡", courseCards, courseCols)}
            {gridBlock("清單卡", listCards, listCols)}
          </View>
        ) : null}
        {admin || canCreateCourse(member) ? <View style={{ height: 64 }} /> : null}
      </Screen>
      {/* 系列封面往下滑縮成迷你小視窗（業主 2026-11-24；與影片迷你小視窗同規格）。 */}
      <CoverMiniFloat cover={<HeroMiniCover art={art} media={cm.items} title={shownTitle} />} label={shownTitle} range={centerHeroFull(winW, winHeight)} />
      {/* 右下角「＋」（業主 2026-11-23：除了中心卡，每個頁面都要有新增鈕）：有新增權限的人可新增教材卡（系列預先選好目前這個系列）；超級管理員另可新增公告（目前這個系列，或首頁公告）。 */}
      {admin || canCreateCourse(member) ? <AddMaterialFab kinds={[...(canCreateCourse(member) ? (["course"] as const) : []), ...(admin ? (["announce"] as const) : [])]} onPick={(k) => (k === "announce" ? setComposeOpen(true) : setNewOpen(true))} /> : null}
      {newOpen ? <NewCourseSheet onClose={() => setNewOpen(false)} defaultSeries={series !== UNCATEGORIZED ? series : undefined} /> : null}
      {composeOpen ? (
        <BroadcastComposer
          targets={[...(series !== UNCATEGORIZED ? [{ scope: "series" as const, name: series, label: `${shownTitle}系列公告` }] : []), { scope: "home" as const, label: "首頁公告" }]}
          onClose={() => setComposeOpen(false)}
          onDone={() => setBcTick((n) => n + 1)}
        />
      ) : null}
      {applyOpen ? <SeriesApplySheet series={series} title={shownTitle} courses={all.filter((x) => !x.isList)} onClose={() => setApplyOpen(false)} /> : null}
      {albumOpen ? (
        <BottomSheet onClose={() => setAlbumOpen(false)}>
          <AppText variant="headline">{`${shownTitle}封面輪播相簿`}</AppText>
          <SheetScroll>
            <View style={{ gap: 12 }}>
              <AlbumUploadButton kind="series" ownerKey={series} count={cm.items.length} onDone={cm.reload} />
              <CoverAlbum kind="series" ownerKey={series} title={shownTitle} items={cm.items} canEdit onChanged={cm.reload} />
            </View>
          </SheetScroll>
        </BottomSheet>
      ) : null}
      {coverOpen ? (
        <SeriesCoverSheet series={series} title={shownTitle} edmUrl={art?.edmUrl} onClose={() => setCoverOpen(false)} onChanged={artList.reload} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { alignSelf: "flex-end", flexDirection: "row", borderWidth: 1, borderRadius: radius.md, overflow: "hidden", height: minTouch, marginBottom: space.sm },
  orderRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  arrows: { gap: 4 },
  arrow: { width: 40, height: 40, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  tbtn: { width: 48, height: "100%", alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP, rowGap: space.lg },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space.md },
});
