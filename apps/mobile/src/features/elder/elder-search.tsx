import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Image, ScrollView, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolveUrl, type CourseSummary } from "@/api/client";
import { buildSearchIndex, charsCourses, expandQuery, fuzzyCourses, matchCourses, rankCourses, type SearchLesson } from "@/features/courses/course-search";
import { useSynonyms } from "@/features/courses/use-synonyms";
import { usePhonetic } from "@/features/courses/use-phonetic";
import { useSemantic } from "@/features/courses/use-semantic";
import { SceneHits } from "@/features/courses/scene-hits";
import { useThumb } from "@/lib/thumb";
import { useProfileRedirect } from "@/features/profile-gate";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { maxContentWidth, radius, space } from "@/theme/tokens";
import { UI_SCALE } from "@/theme/ui-scale";
import { elderTextScale } from "@/lib/elder-mode";
import { fitFontSize } from "@/ui/course-cover";
import { ELDER_FIELD } from "@/ui/elder-controls";
import { AppText, ErrorView, LoadingView, LoginPrompt, ThumbFallback } from "@/ui";
import { TileCover } from "@/features/courses/series-tile";
import { ElderCenterPage } from "./elder-center";
import { ElderInvite, ElderSeriesHead } from "./elder-heads";
import { centerKeyOf, centerTitle, eventDays } from "@/features/format";
import { lessonHref } from "@/lib/lesson-href";
import type { ChapterItem } from "@/features/courses/chapter-list";
import { ELDER_ZONES, ElderZoneCard, ElderZoneHeader, useZoneItems, type ElderZone } from "./elder-zones";
import { useSearchSettings } from "@/features/courses/use-search-settings";
import { SemanticExtras, TagPill, splitExtras } from "@/features/search/semantic-extras";
import { onHomeReset } from "@/lib/home-reset";
import { markFromSearch, useRememberedQuery } from "@/lib/search-memory";
import { listable, useSearchEngine } from "@/features/search/use-search-engine";
import { useVoice } from "./use-voice";

/** 排序：已報名（上過）的優先，其次活動日期新的在前，清單卡最後。 */
function order(list: CourseSummary[]) {
  const mine = (x: CourseSummary) => Number(x.enrollment === "opened" || x.started);
  return [...list].sort((a, b) => Number(a.isList) - Number(b.isList) || mine(b) - mine(a) || (b.eventStart ?? "").localeCompare(a.eventStart ?? ""));
}

/** 「繼續上課」：最近學過、還沒學完的課（都學完就拿最近學的那一門）。 */
function lastCourse(courses: CourseSummary[]): CourseSummary | null {
  const learning = courses
    .filter((x) => !x.isList && (x.enrollment === "opened" || x.started) && !x.hiddenFromLearning)
    .sort((a, b) => (b.lastLearnedAt ?? "").localeCompare(a.lastLearnedAt ?? ""));
  return learning.find((x) => x.completedLessons < x.lessonCount) ?? learning[0] ?? null;
}

/**
 * 至尊模式的找課畫面（業主 2026-11-24，B 方案）。
 * home＝首頁：上方大搜尋框，中間一顆大麥克風（按一下用說的），下面「繼續上課」；打字或說完就原地列出結果。
 * browse＝「課程」分頁：同一個大搜尋框，沒打字時列出全部課程（大字、一列一堂課）。
 */
export function ElderSearch({ mode }: { mode: "home" | "browse" }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { member } = useSession();
  useProfileRedirect(member); // 會員資料沒填完：登入後自動帶到至尊模式頁、捲到沒填的欄位（業主 2026-11-24）
  const courses = useApi<CourseSummary[]>("/courses");
  // 搜尋字只有首頁記住（返回時回到剛剛的搜尋結果）；課程分頁沒有搜尋，不套用記憶（業主 2026-11-25：搜尋結果不應出現在課程頁）。
  const mem = useRememberedQuery("elder");
  const plain = useState("");
  const [q, setQ] = mode === "home" ? mem : plain;
  const [heard, setHeard] = useState<string | null>(null);
  // 課程分頁的四大分類（業主 2026-11-24，D 款）：null＝顯示四張大卡；選了一區＝列出該區課程。
  const [zone, setZone] = useState<ElderZone | null>(null);
  const [sub, setSub] = useState<Row | null>(null); // 系列／中心再往下一層
  const input = useRef<{ focus: () => void } | null>(null);
  const voice = useVoice((text, final) => {
    setHeard(text);
    if (final || text) setQ(text);
  });
  // 搜尋引擎：與超派模式是同一個模組（features/search/use-search-engine.ts），業主 2026-11-25。
  const eng = useSearchEngine(q, courses.data ?? []);
  const { key, all, chapters, semantic, phonetic } = eng;
  const itemsOf = useZoneItems(all);
  // 已經在首頁再按一次底部「首頁」＝清掉搜尋字與語音、回到預設畫面（業主 2026-11-25）。
  useEffect(
    () =>
      onHomeReset(() => {
        if (mode !== "home") return;
        voice.stop();
        setQ("");
        setHeard(null);
        setZone(null);
        setSub(null);
      }),
    [mode], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // 從搜尋結果點「中心卡」會帶 ?center=中心名稱 來到課程分頁：直接打開該中心頁（業主 2026-11-25）。
  const { center: centerParam } = useLocalSearchParams<{ center?: string }>();
  const openedCenter = useRef("");
  useEffect(() => {
    if (mode !== "browse" || typeof centerParam !== "string" || !centerParam || openedCenter.current === centerParam) return;
    const row = itemsOf("centers").find((x) => centerKeyOf(x.title) === centerKeyOf(centerParam));
    if (!row) return;
    openedCenter.current = centerParam;
    setZone("centers");
    setSub(row);
  }, [mode, centerParam, itemsOf]); // eslint-disable-line react-hooks/exhaustive-deps
  // FlatList 的資料：搜尋結果／分類裡的項目／系列或中心裡的課程（業主 2026-11-24：內容與數字與超派模式一致）。
  const rows: Row[] = useMemo(() => {
    if (key) return chapters.map((x) => ({ key: x.lesson.id, title: x.lesson.title, rep: x.course, chapter: x }));
    if (mode !== "browse" || !zone) return [];
    if (sub) return (sub.children ?? []).map((x) => ({ key: x.id, title: x.title, count: x.materialCount, rep: x }));
    return itemsOf(zone);
  }, [key, chapters, mode, zone, sub, itemsOf]);
  // 「繼續上課」只出現在至尊首頁的初始畫面：搜尋中、找不到課程、分類裡都不顯示（業主 2026-11-25）。
  const cont = mode === "home" && !q.trim() && !sub ? lastCourse(courses.data ?? []) : null;
  const searching = q.trim().length > 0;
  const mic = () => {
    if (voice.listening) return voice.stop();
    if (!voice.start()) input.current?.focus(); // 不支援語音辨識：打開鍵盤，用鍵盤上的麥克風說
  };

  const header = (
    <View style={{ gap: space.md }}>
      <View style={[styles.box, { borderColor: c.accent, backgroundColor: c.surface }]}>
        <Ionicons name="search" size={24} color={c.textMuted} />
        <TextInput
          ref={input as never}
          value={q}
          onChangeText={(t) => (setQ(t), setHeard(null))}
          placeholder={mode === "home" ? "打字找課程" : "找課程"}
          placeholderTextColor={c.textMuted}
          returnKeyType="search"
          accessibilityLabel="找課程"
          style={[styles.input, { color: c.text }]}
        />
        {q ? (
          <Pressable accessibilityRole="button" accessibilityLabel="清除" onPress={() => (setQ(""), setHeard(null))} style={[styles.boxBtn, { backgroundColor: c.surfaceMuted }]}>
            <Ionicons name="close" size={26} color={c.text} />
          </Pressable>
        ) : mode === "browse" ? (
          <Pressable accessibilityRole="button" accessibilityLabel="用說的找課程" onPress={mic} style={[styles.boxBtn, { backgroundColor: c.accent }]}>
            <Ionicons name="mic" size={26} color={c.textOnAccent} />
          </Pressable>
        ) : null}
      </View>
      {member || voice.listening ? null : <LoginPrompt />}
      {searching && !voice.listening ? (
        <AppText variant="headline">{chapters.length ? `找到 ${chapters.length} 個單元` : eng.loading ? "正在找相近的單元…" : eng.extras.length ? `找到 ${eng.extras.length} 個相近的項目` : "找不到這個單元"}</AppText>
      ) : null}
      {searching && !voice.listening ? <SceneHits q={q} big /> : null}
    </View>
  );

  const body =
    voice.listening ? (
      <Listening heard={heard} levels={voice.levels} onStop={voice.stop} />
    ) : courses.error && !courses.data ? (
      <ErrorView message={courses.error} onRetry={courses.reload} />
    ) : !courses.data ? (
      <LoadingView />
    ) : mode === "home" && !searching ? (
      <View style={styles.center}>
        <Pressable accessibilityRole="button" accessibilityLabel="按一下，用說的找課程" onPress={mic} style={({ pressed }) => [styles.micWrap, { backgroundColor: c.accentSoft, opacity: pressed ? 0.85 : 1 }]}>
          <View style={[styles.mic, { backgroundColor: c.accent }]}>
            <Ionicons name="mic" size={60} color={c.textOnAccent} {...({ uiOnly: true } as object)} />
          </View>
        </Pressable>
        <FitLine text="按一下，用說的" max={44} />
        {voice.supported ? <TypoHint /> : null}
        {voice.supported ? <SearchHint /> : (
          <AppText tone="muted" style={{ textAlign: "center" }}>
            會打開鍵盤，請按鍵盤上的麥克風說話
          </AppText>
        )}
        {voice.error ? <AppText tone="danger" style={{ textAlign: "center" }}>{voice.error}</AppText> : null}
      </View>
    ) : key && !chapters.length && !eng.extras.length && !eng.loading ? (
      // 找不到課程：畫面中央放錄音鈕，按一下再說一次（業主 2026-11-25）。
      <View style={styles.center}>
        <AppText variant="headline" style={{ textAlign: "center" }}>{`找不到「${q.trim()}」，再說一次試試看`}</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel="再說一次" onPress={mic} style={({ pressed }) => [styles.micWrap, { backgroundColor: c.accentSoft, opacity: pressed ? 0.85 : 1 }]}>
          <View style={[styles.mic, { backgroundColor: c.accent }]}>
            <Ionicons name="mic" size={60} color={c.textOnAccent} {...({ uiOnly: true } as object)} />
          </View>
        </Pressable>
        <FitLine text="按一下，再說一次" max={36} />
        {voice.error ? <AppText tone="danger" style={{ textAlign: "center" }}>{voice.error}</AppText> : null}
      </View>
    ) : null;

  // 搜尋框固定在最上面、與下方內容分開（業主 2026-11-24 驗證回報：打一個字畫面就換成另一棵元件樹，輸入框被重建、鍵盤收起，只留得下第一個字）。
  // 不論有沒有結果、是否在聽，搜尋框永遠是同一個位置的同一個元件，才不會中斷輸入。
  const pad = { paddingHorizontal: space.md };
  // 進入分類後：標題條固定在搜尋框下面（不隨清單捲走）、背景有該分類的浮水印大圖示（業主 2026-11-24，選 E 款）。
  const zoneDef = ELDER_ZONES.find((z) => z.id === zone);
  const inZone = mode === "browse" && !searching && !!zoneDef;
  // 進入「中心」之後：四個分頁（EDM／課表／重播／列表）改成可展開的區塊（業主 2026-11-24）。
  const centerPage = inZone && zone === "centers" && !!sub;
  // 進入「系列」之後（業主 2026-11-24：與中心卡統一）：上方封面＋訂閱＋點閱、公告，標題區右上角邀請。
  const seriesName = inZone && !centerPage && sub?.series ? sub.rep.series || null : null;
  const listMode = !body && !(!searching && mode === "home");
  const listHeader: ReactNode = seriesName ? (
              <ElderSeriesHead key={seriesName} series={seriesName} title={sub!.title} />
            ) : mode === "browse" && !searching && !zone ? (
              <View style={{ gap: space.md }}>
                {ELDER_ZONES.map((z) => (
                  <ElderZoneCard key={z.id} zone={z} count={itemsOf(z.id).reduce((n, x) => n + x.count, 0)} onPress={() => (setSub(null), setZone(z.id))} />
                ))}
              </View>
            ) : key ? (
              // 其他項目放進「可捲動」的清單裡（業主 2026-11-25：放在固定的上半部，項目一多就佔滿畫面、清單捲不動）。
              <SemanticExtras items={eng.extras} big />
            ) : undefined;
  const listFooter: ReactNode = undefined;
  const renderRow = (item: Row) => item.chapter ? <ElderChapterRow key={item.key} item={item.chapter} /> : <ElderCourseRow course={item.rep} title={item.title} count={item.count} onPress={item.children ? () => setSub(item) : undefined} series={item.series} coverUrl={item.coverUrl} typeTag={item.tag} />;

  return (
    <View style={[styles.fill, { backgroundColor: c.background }]}>
      {/* 課程分頁不再有搜尋框（業主 2026-11-24：移除置頂搜尋）；搜尋只在首頁。 */}
      {mode === "home" ? <View style={[styles.inner, pad, { paddingTop: insets.top + space.md, paddingBottom: space.sm }]}>{header}</View> : <View style={{ height: insets.top + space.md }} />}
      {inZone ? (
        <View style={[styles.inner, pad, { paddingBottom: space.sm }]}>
          <ElderZoneHeader
            zone={zoneDef!}
            sub={sub?.title}
            onBack={() => (sub ? setSub(null) : setZone(null))}
            right={
              centerPage ? (
                <ElderInvite kind="center" value={sub!.title} title={centerTitle(sub!.title)} fallback={`/courses?center=${encodeURIComponent(sub!.title)}`} />
              ) : seriesName ? (
                <ElderInvite kind="series" value={seriesName} title={sub!.title} fallback={`/series/${encodeURIComponent(seriesName)}`} />
              ) : undefined
            }
          />
        </View>
      ) : null}
      {centerPage ? (
        <ScrollView style={styles.fill} contentContainerStyle={[styles.inner, pad, { paddingBottom: space.xxl }]}>
          <ElderCenterPage
            key={sub!.key}
            center={sub!.title}
            courses={sub!.children ?? []}
            renderCourses={() => (
              <View>
                {(sub!.children ?? []).map((x) => (
                  <ElderCourseRow key={x.id} course={x} count={x.materialCount} />
                ))}
              </View>
            )}
          />
        </ScrollView>
      ) : listMode ? (
        // 網頁：不用會即時增減畫面項目的 FlatList，改成一般捲動清單（業主 2026-11-25：手機系統的長截圖拼接要整頁內容穩定；結果最多幾十筆，不需要虛擬化）。
        Platform.OS === "web" ? (
          <ScrollView style={styles.fill} contentContainerStyle={[styles.inner, pad, { paddingBottom: space.xxl }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {listHeader}
            {rows.map((item) => renderRow(item))}
            {listFooter}
          </ScrollView>
        ) : (
        <FlatList
          style={styles.fill}
          contentContainerStyle={[styles.inner, pad, { paddingBottom: space.xxl }]}
          data={rows}
          keyExtractor={(x) => x.key}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          renderItem={({ item }) => renderRow(item)}
          initialNumToRender={60} maxToRenderPerBatch={60} windowSize={21}
        />
        )
      ) : (
        <View style={[styles.inner, pad, { flex: 1, gap: space.md, paddingBottom: space.md }]}>
          {body}
          {cont && !voice.listening ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`繼續上課：${cont.title}`} onPress={() => router.push(`/course/${cont.id}`)} style={({ pressed }) => [styles.cont, { backgroundColor: c.navPill, opacity: pressed ? 0.85 : 1 }]}>
              <Ionicons name="play" size={26} color={c.navPillText} />
              <View style={{ flex: 1 }}>
                <AppText variant="headline" style={{ color: c.navPillText }}>
                  繼續上課
                </AppText>
                <AppText numberOfLines={1} style={{ color: c.navPillText, lineHeight: 18 }}>
                  {cont.title}
                </AppText>
              </View>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

/** 搜尋提示文字（業主 2026-11-25）：首頁麥克風下方與「正在聽」畫面共用這一個，改這裡兩邊一起變；行距縮到最小。 */
export const SEARCH_HINT = "例如：「王老師 表揚大會 淨水器 營養」"; // 空格一律半型
export const TYPO_HINT = "說錯字不用改 都能找得到";
/** 一行文字的估計寬度（以「字級」為單位）：半型空格 0.32、其他半型 0.6、中文與全型 1。 */
const lineUnits = (t: string) => [...t].reduce((n, ch) => n + (ch === " " ? 0.32 : ch.charCodeAt(0) < 128 ? 0.6 : 1), 0);
/** 強制一行、字級自動放到剛好塞滿可用寬度（業主 2026-11-25）：太長自動縮小，短的放大到 max 為止。首頁與「正在聽」共用。 */
export function FitLine({ text, max = 30, min = 10, weight = "700", muted, tight }: { text: string; max?: number; min?: number; weight?: "400" | "700" | "800"; muted?: boolean; tight?: boolean }) {
  const [w, setW] = useState(0);
  const k = UI_SCALE * elderTextScale();
  const size = w ? Math.max(min, Math.min(max, Math.floor(w / k / (lineUnits(text) * 1.06)))) : Math.min(max, 18);
  return (
    <View style={{ alignSelf: "stretch", ...(tight ? { marginTop: -space.sm } : null) }} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
      <AppText tone={muted ? "muted" : undefined} numberOfLines={1} style={{ textAlign: "center", fontSize: size, lineHeight: Math.round(size * 1.15), fontWeight: weight }}>
        {text}
      </AppText>
    </View>
  );
}
export function SearchHint() {
  return <FitLine text={SEARCH_HINT} max={16} weight="400" muted />;
}
/** 中央黑色標題下方的黑字提示（業主 2026-11-25：強制一行、自動縮放到最大寬度）。 */
export function TypoHint() {
  return <FitLine text={TYPO_HINT} max={22} tight />;
}

/** 「正在聽…」：跟著聲音大小即時高低跳動的音波＋聽到的字＋停止鈕（業主 2026-11-24）。 */
function Listening({ heard, levels, onStop }: { heard: string | null; levels: number[]; onStop: () => void }) {
  const { c } = useTheme();
  // 一切縮小、行距收緊（業主 2026-11-25）：音波、字體都再縮小；聽到的字太多時自動縮字，永遠塞得進畫面、不重疊。
  const max = Math.round(64 * UI_SCALE);
  const min = Math.round(8 * UI_SCALE);
  return (
    <View style={styles.listen} accessibilityLiveRegion="polite">
      {/* 上半部是固定高度的內容區（聽到的字、音波、提示）；「送出」鈕固定釘在最下面，不論內容怎麼變，位置永遠不動（業主 2026-11-25）。 */}
      <View style={{ flex: 1, alignSelf: "stretch", alignItems: "center", gap: 4, overflow: "hidden" }}>
        <View style={{ height: Math.round(120 * UI_SCALE), alignSelf: "stretch", justifyContent: "center" }}>{heard ? <HeardText text={`聽到：「${heard}」`} /> : null}</View>
        <View style={[styles.wave, { height: max, gap: 5 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {levels.map((v, i) => (
            <View key={i} style={[{ width: Math.round(8 * UI_SCALE), height: Math.round(min + v * (max - min)), borderRadius: 5, backgroundColor: c.accent }, WAVE_ANIM]} />
          ))}
        </View>
        <AppText style={{ fontSize: 20, lineHeight: 22, fontWeight: "800" }}>正在聽…</AppText>
        <TypoHint />
        <AppText tone="muted" style={{ textAlign: "center", fontSize: 14, lineHeight: 16, opacity: heard ? 0 : 1 }}>
          請說出想找的課程
        </AppText>
        <SearchHint />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="送出" onPress={onStop} style={[styles.stop, { borderColor: c.danger, borderWidth: ELDER_FIELD.borderWidth, minHeight: 52, marginTop: 6 }]}>
        <AppText variant="headline" style={{ color: c.danger, lineHeight: 22 }}>
          送出
        </AppText>
      </Pressable>
    </View>
  );
}

/** 聽到的字（紅色）：依字數與可用寬度自動縮小字級，最多佔約 5 行高，絕不超出、不與其他文字重疊。 */
function HeardText({ text }: { text: string }) {
  const { c } = useTheme();
  const [w, setW] = useState(0);
  const k = UI_SCALE * elderTextScale();
  const budget = 110 / elderTextScale(); // 外框固定 120×UI_SCALE，字被放大時可用的行數相對變少
  let size = 12;
  if (w) {
    const units = lineUnits(text) * 1.05;
    for (let s = 22; s >= 12; s--) {
      const lines = Math.ceil((units * s) / (w / k));
      if (lines * s * 1.15 <= budget) {
        size = s;
        break;
      }
    }
  } else size = 18;
  return (
    <View style={{ alignSelf: "stretch" }} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
      <AppText style={{ color: c.danger, textAlign: "center", fontWeight: "800", fontSize: size, lineHeight: Math.round(size * 1.15) }}>{text}</AppText>
    </View>
  );
}

/** 網頁版音波高度變化加一點過渡，看起來比較順。 */
const WAVE_ANIM = (Platform.OS === "web" ? { transitionProperty: "height", transitionDuration: "90ms", transitionTimingFunction: "ease-out" } : {}) as object;

/** 至尊模式的課程列：大縮圖、大字標題、狀態（已報名／審核中／免費／付費）。整列都可以點。 */
export type Row = { key: string; title: string; tag?: string; /** 搜尋結果的單元（章節）列。 */ chapter?: ChapterItem; count?: number; rep: CourseSummary; children?: CourseSummary[]; series?: boolean; coverUrl?: string | null };

export function ElderCourseRow({ course, title, count, onPress, series, coverUrl, typeTag }: { course: CourseSummary; /** 搜尋結果：資料類別膠囊標籤（課程卡／教材卡）。 */ typeTag?: string; title?: string; /** 有給＝標籤顯示「N 項教材」（分類清單，與超派模式一致）；沒給＝顯示報名狀態。 */ count?: number; onPress?: () => void; /** true＝這列是系列（封面用系列封面）。 */ series?: boolean; /** 中心列：中心封面圖（與超派模式的中心卡一致）。 */ coverUrl?: string | null }) {
  const { c } = useTheme();
  // 封面一律直式 4:3（寬 3：高 4），封面挑選與超派模式同一份程式（TileCover，業主 2026-11-24 永久指示）。
  const w = Math.round(96 * UI_SCALE);
  const h = Math.round((w * 4) / 3);
  const tag = count !== undefined ? `${count} 項教材` : course.isList ? "教材" : course.enrollment === "opened" ? "已報名" : course.enrollment === "pending" ? "審核中" : course.priceTba ? "費用未公布" : course.free || course.freeNow || course.watchFree ? "免費" : "付費";
  const strong = tag === "已報名";
  const label = title ?? course.title;
  const thumb = useThumb();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}，${tag}`} onPress={onPress ?? (() => router.push(`/course/${course.id}`))} style={({ pressed }) => [styles.row, { borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}>
      <View style={[styles.thumb, { width: w, height: h, backgroundColor: c.surfaceMuted }]}>
        {coverUrl ? <Image source={{ uri: thumb(resolveUrl(coverUrl), w * 2) }} style={{ width: w, height: h }} resizeMode="cover" /> : <TileCover rep={course} width={w} height={h} flat={!series} inSeries={!!series} title={label} />}
      </View>
      <View style={{ flex: 1, height: h, gap: 6, minWidth: 0 }}>
        <FitTitle text={label} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {typeTag ? <TagPill label={typeTag} big /> : null}
          <View style={[styles.tag, { backgroundColor: strong ? c.accent : c.accentSoft }]}>
            <AppText variant="callout" style={{ color: strong ? c.textOnAccent : c.accentText, fontWeight: "700" }}>
              {tag}
            </AppText>
          </View>
        </View>
      </View>
      {/* 不放右側箭頭（業主 2026-11-24：讓標題文字完整呈現），整列都可以點。 */}
    </Pressable>
  );
}

/**
 * 列上的課程標題（業主 2026-11-24）：標準字級 `TITLE_SIZE`，依剩餘寬度自然換行（不提早斷行）；
 * 資訊卡高度固定（＝封面高度），標題字數太多放不下時才**縮小字級**，一定完整顯示全部文字。
 * 斷行處由瀏覽器依寬度決定，不做任何字數對齊；網頁版用 data-plainwrap 排除至尊模式的 text-wrap: balance（會讓斷行提早）。
 * 畫字時會再乘「平板倍數 × 至尊倍數」，所以估算要在放大前的尺寸上算。
 */
const TITLE_SIZE = 22;
/** 搜尋結果的「單元」列（跟超派 ChapterList 同內容同順序，業主 2026-11-25）：大縮圖、標題、日期與所屬教材卡、狀態；點下去能看就直接播放，不能看進課程頁。 */
function ElderChapterRow({ item }: { item: ChapterItem }) {
  const { c } = useTheme();
  const thumb = useThumb();
  const { lesson, course, locked } = item;
  const w = Math.round(96 * UI_SCALE);
  const h = Math.round((w * 4) / 3);
  const open = !locked && lesson.ready;
  const date = lesson.eventDate ? eventDays(lesson.eventDate, null) : course.eventStart ? eventDays(course.eventStart, course.eventEnd) : "";
  const cover = lesson.coverUrl || course.coverUrl || course.edmUrl;
  const status = lesson.completed ? "已完成" : !lesson.ready ? "敬請期待" : locked ? "報名後觀看" : "";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${lesson.title}，${course.title}`} onPress={() => (markFromSearch(), router.push((open ? lessonHref(course.id, lesson.id) : `/course/${course.id}`) as never))} style={({ pressed }) => [styles.row, { borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}>
      <View style={[styles.thumb, { width: w, height: h, backgroundColor: c.surfaceMuted }]}>
        {cover ? <Image source={{ uri: thumb(resolveUrl(cover), w * 2) }} style={{ width: w, height: h }} resizeMode="cover" /> : <TileCover rep={course} width={w} height={h} flat inSeries={false} title={course.title} />}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <AppText variant="headline" numberOfLines={3} style={{ fontWeight: "800" }}>{lesson.title}</AppText>
        <AppText variant="callout" tone="muted" numberOfLines={2}>{[date, course.title].filter(Boolean).join(" · ")}</AppText>
        {status ? (
          <View style={[styles.tag, { backgroundColor: c.accentSoft }]}>
            <AppText variant="callout" style={{ color: c.accentText, fontWeight: "700" }}>{status}</AppText>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function FitTitle({ text }: { text: string }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const k = UI_SCALE * elderTextScale();
  const fs = box.w && box.h ? Math.min(TITLE_SIZE, fitFontSize(text, box.w / k, (box.h / k) * 0.92, TITLE_SIZE, 10)) : TITLE_SIZE;
  return (
    <View style={{ flex: 1, minHeight: 0, justifyContent: "center" }} onLayout={(e) => setBox({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) })}>
      <AppText {...({ dataSet: { plainwrap: "" } } as object)} style={{ fontSize: fs, lineHeight: Math.round(fs * 1.25), fontWeight: "800" }}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  inner: { width: "100%", maxWidth: maxContentWidth, alignSelf: "center" },
  box: { flexDirection: "row", alignItems: "center", gap: space.sm, borderWidth: ELDER_FIELD.borderWidth, borderRadius: ELDER_FIELD.radius, paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: space.sm, minHeight: Math.round(80 * UI_SCALE) },
  input: { flex: 1, fontSize: 20, lineHeight: 28, paddingVertical: space.sm, minWidth: 0, outlineStyle: "none" } as object,
  boxBtn: { width: Math.round(56 * UI_SCALE), height: Math.round(56 * UI_SCALE), borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  listen: { flex: 1, alignItems: "center", justifyContent: "space-between", paddingTop: 6, paddingBottom: 6 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingVertical: space.md },
  micWrap: { padding: 18, borderRadius: 999 },
  mic: { width: Math.round(120 * UI_SCALE), height: Math.round(120 * UI_SCALE), borderRadius: 999, alignItems: "center", justifyContent: "center" },
  wave: { flexDirection: "row", alignItems: "center", gap: 8 },
  stop: { minHeight: 64, minWidth: 200, borderWidth: 3, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", marginTop: space.md },
  cont: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 76, borderRadius: radius.lg + 4, paddingHorizontal: space.lg, paddingVertical: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, borderBottomWidth: 1, paddingVertical: space.md },
  thumb: { borderRadius: radius.md, overflow: "hidden" },
  tag: { alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 2 },
});
