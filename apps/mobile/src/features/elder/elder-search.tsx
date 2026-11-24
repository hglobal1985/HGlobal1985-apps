import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { FlatList, Image, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolveUrl, type CourseSummary } from "@/api/client";
import { buildSearchIndex, charsCourses, fuzzyCourses, matchCourses, rankCourses, type SearchLesson } from "@/features/courses/course-search";
import { usePhonetic } from "@/features/courses/use-phonetic";
import { useSemantic } from "@/features/courses/use-semantic";
import { useThumb } from "@/lib/thumb";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { maxContentWidth, radius, space } from "@/theme/tokens";
import { UI_SCALE } from "@/theme/ui-scale";
import { ELDER_FIELD } from "@/ui/elder-controls";
import { AppText, ErrorView, LoadingView, LoginPrompt, ThumbFallback } from "@/ui";
import { useVoice } from "./use-voice";

/** 至尊模式列得出來的課程：上架中、不是「只限網址」的課程（清單卡也列，排在課程後面）。 */
const listable = (x: CourseSummary) => x.status === "published" && x.viewScope !== "link_login" && x.viewScope !== "link_guest";

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
  const courses = useApi<CourseSummary[]>("/courses");
  const [q, setQ] = useState("");
  const [heard, setHeard] = useState<string | null>(null);
  const input = useRef<{ focus: () => void } | null>(null);
  // 搜尋索引（章節標題、分享者、日期…）：開始找的時候才下載。
  const wantIndex = q.trim().length > 0 || mode === "browse";
  const idx = useApi<{ lessons: SearchLesson[] }>(wantIndex ? "/search-index" : null);
  const voice = useVoice((text, final) => {
    setHeard(text);
    if (final || text) setQ(text);
  });
  const all = useMemo(() => (courses.data ?? []).filter(listable), [courses.data]);
  const index = useMemo(() => (idx.data ? buildSearchIndex(all, idx.data.lessons) : buildSearchIndex(all, [])), [all, idx.data]);
  // 與寰宇大學（超派模式）同一套找法（業主 2026-11-24 回報：語音說「線上白金」找不到課）：
  // 完全比對 → 模糊比對＋字元比對 → AI 語意搜尋（完全比對沒結果時才送出，合併顯示）。
  // 語音辨識有時會在句中加標點（「線上，白金」）：比對前一律換成空白。
  const key = useMemo(() => q.replace(/[。．.！!？?，,、；;：:「」“”"'（）()]+/g, " ").trim(), [q]);
  const exact = useMemo(() => (key ? matchCourses(index, key) : null), [index, key]);
  const noExact = !!exact && exact.size === 0;
  const semantic = useSemantic(key, noExact);
  const phonetic = usePhonetic(key, noExact);
  // 排序（業主 2026-11-24，與超派模式共用 rankCourses）：關聯性高 > 日期最新 > 已報名。
  const results = useMemo(() => {
    if (!key) return mode === "browse" ? order(all) : [];
    const byLesson = new Map((idx.data?.lessons ?? []).map((l) => [l.id, l.courseId]));
    const lessonCourses = (ids: Iterable<string>) => [...ids].map((lid) => byLesson.get(lid)).filter((x): x is string => !!x && index.haystack.has(x));
    let ids: Set<string> = exact ?? new Set();
    let near: Parameters<typeof rankCourses>[3] = {};
    if (!ids.size) {
      const fuzzy = fuzzyCourses(index, key);
      const chars = charsCourses(index, key);
      const phon = [...phonetic.courses, ...lessonCourses(phonetic.lessons)].filter((id) => index.haystack.has(id));
      const sem = [...semantic.courses, ...lessonCourses(semantic.lessons)].filter((id) => index.haystack.has(id));
      ids = new Set([...fuzzy, ...chars, ...phon, ...sem]);
      near = { phonetic: phon, semantic: sem, fuzzy, chars };
    }
    return rankCourses(index, all.filter((x) => ids.has(x.id)), key, near);
  }, [key, index, all, mode, exact, semantic.courses, semantic.lessons, phonetic.courses, phonetic.lessons, idx.data]);
  const cont = mode === "home" ? lastCourse(courses.data ?? []) : null;
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
      {member ? null : <LoginPrompt />}
      {searching ? (
        <AppText variant="headline">{results.length ? `找到 ${results.length} 堂課` : semantic.loading || phonetic.loading ? "正在找相近的課程…" : "找不到這個課程，換個字試試看"}</AppText>
      ) : null}
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
            <Ionicons name="mic" size={84} color={c.textOnAccent} {...({ uiOnly: true } as object)} />
          </View>
        </Pressable>
        <AppText variant="headline" style={{ textAlign: "center" }}>
          按一下，用說的
        </AppText>
        <AppText tone="muted" style={{ textAlign: "center" }}>
          {voice.supported ? "例如：「營養課」" : "會打開鍵盤，請按鍵盤上的麥克風說話"}
        </AppText>
        {voice.error ? <AppText tone="danger" style={{ textAlign: "center" }}>{voice.error}</AppText> : null}
      </View>
    ) : null;

  // 搜尋框固定在最上面、與下方內容分開（業主 2026-11-24 驗證回報：打一個字畫面就換成另一棵元件樹，輸入框被重建、鍵盤收起，只留得下第一個字）。
  // 不論有沒有結果、是否在聽，搜尋框永遠是同一個位置的同一個元件，才不會中斷輸入。
  const pad = { paddingHorizontal: space.md };
  const listMode = !body && !(!searching && mode === "home");
  return (
    <View style={[styles.fill, { backgroundColor: c.background }]}>
      <View style={[styles.inner, pad, { paddingTop: insets.top + space.md, paddingBottom: space.sm }]}>{header}</View>
      {listMode ? (
        <FlatList
          style={styles.fill}
          contentContainerStyle={[styles.inner, pad, { paddingBottom: space.xxl }]}
          data={results}
          keyExtractor={(x) => x.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => <ElderCourseRow course={item} />}
          initialNumToRender={8}
        />
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
                <AppText numberOfLines={1} style={{ color: c.navPillText }}>
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

/** 「正在聽…」：跟著聲音大小即時高低跳動的音波＋聽到的字＋停止鈕（業主 2026-11-24）。 */
function Listening({ heard, levels, onStop }: { heard: string | null; levels: number[]; onStop: () => void }) {
  const { c } = useTheme();
  const max = Math.round(120 * UI_SCALE);
  const min = Math.round(14 * UI_SCALE);
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <View style={[styles.wave, { height: max }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {levels.map((v, i) => (
          <View key={i} style={[{ width: Math.round(14 * UI_SCALE), height: Math.round(min + v * (max - min)), borderRadius: 8, backgroundColor: c.accent }, WAVE_ANIM]} />
        ))}
      </View>
      <AppText variant="title">正在聽…</AppText>
      <AppText tone="muted" style={{ textAlign: "center" }}>
        {heard ? `聽到：「${heard}」` : "請說出想找的課程"}
      </AppText>
      <Pressable accessibilityRole="button" onPress={onStop} style={[styles.stop, { borderColor: c.danger }]}>
        <AppText variant="headline" style={{ color: c.danger }}>
          停止
        </AppText>
      </Pressable>
    </View>
  );
}

/** 網頁版音波高度變化加一點過渡，看起來比較順。 */
const WAVE_ANIM = (Platform.OS === "web" ? { transitionProperty: "height", transitionDuration: "90ms", transitionTimingFunction: "ease-out" } : {}) as object;

/** 至尊模式的課程列：大縮圖、大字標題、狀態（已報名／審核中／免費／付費）。整列都可以點。 */
export function ElderCourseRow({ course }: { course: CourseSummary }) {
  const { c } = useTheme();
  const thumb = useThumb();
  const img = course.coverUrl ?? course.edmUrl;
  const size = Math.round(84 * UI_SCALE);
  const tag = course.isList ? "教材" : course.enrollment === "opened" ? "已報名" : course.enrollment === "pending" ? "審核中" : course.priceTba ? "費用未公布" : course.free || course.freeNow || course.watchFree ? "免費" : "付費";
  const strong = tag === "已報名";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${course.title}，${tag}`} onPress={() => router.push(`/course/${course.id}`)} style={({ pressed }) => [styles.row, { borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}>
      <View style={[styles.thumb, { width: size, height: size, backgroundColor: c.accentSoft }]}>
        {img ? <Image source={{ uri: thumb(resolveUrl(img), size * 2) }} style={{ width: size, height: size }} resizeMode="cover" /> : <ThumbFallback />}
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <AppText variant="headline" numberOfLines={3}>
          {course.title}
        </AppText>
        <View style={[styles.tag, { backgroundColor: strong ? c.accent : c.accentSoft }]}>
          <AppText variant="callout" style={{ color: strong ? c.textOnAccent : c.accentText, fontWeight: "700" }}>
            {tag}
          </AppText>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={26} color={c.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  inner: { width: "100%", maxWidth: maxContentWidth, alignSelf: "center" },
  box: { flexDirection: "row", alignItems: "center", gap: space.sm, borderWidth: ELDER_FIELD.borderWidth, borderRadius: ELDER_FIELD.radius, paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: space.sm, minHeight: Math.round(80 * UI_SCALE) },
  input: { flex: 1, fontSize: 20, lineHeight: 28, paddingVertical: space.sm, minWidth: 0, outlineStyle: "none" } as object,
  boxBtn: { width: Math.round(56 * UI_SCALE), height: Math.round(56 * UI_SCALE), borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingVertical: space.md },
  micWrap: { padding: 18, borderRadius: 999 },
  mic: { width: Math.round(170 * UI_SCALE), height: Math.round(170 * UI_SCALE), borderRadius: 999, alignItems: "center", justifyContent: "center" },
  wave: { flexDirection: "row", alignItems: "center", gap: 8 },
  stop: { minHeight: 64, minWidth: 200, borderWidth: 3, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", marginTop: space.md },
  cont: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 76, borderRadius: radius.lg + 4, paddingHorizontal: space.lg, paddingVertical: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, borderBottomWidth: 1, paddingVertical: space.md },
  thumb: { borderRadius: radius.md, overflow: "hidden" },
  tag: { alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 2 },
});
